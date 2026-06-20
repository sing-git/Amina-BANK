import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import "./clusters.css";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  type Simulation,
} from "d3-force";
import {
  buildGraph,
  categoryLabel,
  dimensionHue,
  dimensionLabel,
  type ArticleRef,
  type CategoryNode,
  type GraphNode,
  type HubNode,
  type LeafNode,
  type RawCompany,
} from "./graph";
import { fetchDriftSignals } from "../api";

// ---- virtual canvas (SVG scales to fill its container via viewBox) ----
const VW = 1120;
const VH = 880;
const CX = VW / 2;
const CY = VH / 2;
const HUB_RING = 205;

// ---- color helpers: every node in a cluster shares one hue ----
const hubFill = (h: number) => `hsl(${h} 52% 40%)`;
const categoryFill = (h: number) => `hsl(${h} 30% 88%)`; // role-type bubble: pale, ringed
const subHubFill = (h: number) => `hsl(${h} 46% 60%)`; // a leaf that anchors its own sub-cluster
const leafFill = (h: number) => `hsl(${h} 40% 80%)`;
const clusterEdge = (h: number) => `hsl(${h} 38% 55%)`;
const INK_EDGE = "rgba(36,31,24,0.15)";

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));

type Selection =
  | { kind: "hub"; node: HubNode }
  | { kind: "category"; node: CategoryNode }
  | { kind: "leaf"; node: LeafNode }
  | null;

export function ClustersView() {
  const [companies, setCompanies] = useState<RawCompany[] | null>(null);

  useEffect(() => {
    fetchDriftSignals().then(setCompanies);
  }, []);

  const graph = useMemo(() => (companies ? buildGraph(companies) : null), [companies]);

  if (!graph) return <div className="cl-loading">Building clusters…</div>;
  return <ClustersInner key={companies?.length} graph={graph} />;
}

function ClustersInner({ graph }: { graph: NonNullable<ReturnType<typeof buildGraph>> }) {
  // ---- controls ----
  const [query, setQuery] = useState("");
  const [activeDims, setActiveDims] = useState<Set<string>>(new Set(graph.dimensions));
  const [showLeaves, setShowLeaves] = useState(true);

  // ---- interaction ----
  const [hoverCompany, setHoverCompany] = useState<string | null>(null);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);

  // ---- zoom / pan (CSS transform on a wrapper <g>); node morphs via CSS too ----
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [focused, setFocused] = useState<string | null>(null); // isolated cluster (companyId)
  const [smooth, setSmooth] = useState(false); // animate camera (off during wheel/pan)
  const [morphing, setMorphing] = useState(false); // hide edges during a node morph
  const viewRef = useRef(view);
  const svgRef = useRef<SVGSVGElement>(null);
  const panRef = useRef<{ x0: number; y0: number; vx: number; vy: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const morphTimer = useRef(0);
  const globalPosRef = useRef<Map<string, { x: number; y: number }>>(new Map()); // settled (global) layout

  // ---- simulation nodes (mutated in place by d3) ----
  const nodesRef = useRef<GraphNode[]>([]);
  const [, forceFrame] = useState(0);

  // Build sim nodes once per graph and run the force layout, animating the settle.
  useEffect(() => {
    const hubR = (h: HubNode) => lerp(17, 38, (h.keptCount - 1) / 17);
    const maxLeaf = Math.max(1, ...graph.leaves.map((l) => l.count));
    const leafR = (l: LeafNode) =>
      lerp(7, 22, Math.sqrt((l.count - 1) / Math.max(1, maxLeaf - 1)));

    const center: GraphNode = {
      ...graph.center,
      x: CX,
      y: CY,
      fx: CX,
      fy: CY,
      r: 42,
    };

    const catR = (c: CategoryNode) => lerp(15, 30, Math.min(c.count, 12) / 12);

    const hubCount = graph.hubs.length;
    const hubNodes: GraphNode[] = graph.hubs.map((h, i) => {
      const a = (2 * Math.PI * i) / hubCount - Math.PI / 2;
      return {
        ...h,
        r: hubR(h),
        x: CX + HUB_RING * Math.cos(a),
        y: CY + HUB_RING * Math.sin(a),
      };
    });
    const hubAngle = new Map(hubNodes.map((h, i) => [h.id, (2 * Math.PI * i) / hubCount - Math.PI / 2]));

    // Satellites = category bubbles + entity leaves. Each orbits its parent (hub,
    // category bubble, or sub-hub leaf). Tighter when the parent isn't the hub.
    const parentKindOf = (d: GraphNode) =>
      d.kind === "category" || d.kind === "leaf" ? (d as LeafNode).parentKind : "hub";
    const tightParent = (d: GraphNode) => d.kind === "leaf" && (d as LeafNode).parentKind !== "hub";

    const satellites: GraphNode[] = [
      ...graph.categories.map((c) => ({ ...c, r: catR(c) }) as GraphNode),
      ...graph.leaves.map((l) => ({ ...l, r: leafR(l) }) as GraphNode),
    ];
    const sibByParent = new Map<string, number>();
    for (const s of satellites)
      sibByParent.set((s as LeafNode).parentId, (sibByParent.get((s as LeafNode).parentId) ?? 0) + 1);

    // Place parents before children: hub-parented (tier 0) → category-parented (1) → leaf-parented (2).
    const tier = (k: string) => (k === "hub" ? 0 : k === "category" ? 1 : 2);
    const ordered = [...satellites].sort((a, b) => tier(parentKindOf(a)) - tier(parentKindOf(b)));

    const idxByParent = new Map<string, number>();
    const satById = new Map<string, GraphNode>();
    for (const s of ordered) {
      const pid = (s as LeafNode).parentId;
      const pk = parentKindOf(s);
      const sib = sibByParent.get(pid) ?? 1;
      const idx = idxByParent.get(pid) ?? 0;
      idxByParent.set(pid, idx + 1);

      let px: number, py: number, baseAngle: number, ringR: number;
      if (pk === "hub") {
        baseAngle = hubAngle.get(pid) ?? 0;
        px = CX + HUB_RING * Math.cos(baseAngle);
        py = CY + HUB_RING * Math.sin(baseAngle);
        // push category bubbles further out so their own children-ring clears the hub
        const extra = s.kind === "category" ? Math.min((s as CategoryNode).count, 18) * 1.2 : 0;
        ringR = 58 + Math.min(sib, 22) * 3.0 + extra;
      } else {
        const parent = satById.get(pid);
        px = parent?.x ?? CX;
        py = parent?.y ?? CY;
        baseAngle = Math.atan2(py - CY, px - CX); // fan children outward from center
        // ring grows with sibling count so a busy bubble (e.g. 17 investors) doesn't bunch
        ringR = (parent?.r ?? 14) + (s.r ?? 8) + 12 + Math.min(sib, 18) * 1.3;
      }
      const a = baseAngle + (idx / Math.max(1, sib)) * 2 * Math.PI;
      s.x = px + ringR * Math.cos(a);
      s.y = py + ringR * Math.sin(a);
      s.targetR = ringR;
      satById.set((s as LeafNode).id, s);
    }

    const nodes = [center, ...hubNodes, ...satellites];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    nodesRef.current = nodes;

    // Custom force: pull each satellite onto a ring around ITS PARENT. Non-hub parents
    // bind tightly so categories / sub-hubs read as distinct little sub-clusters.
    function orbit(alpha: number) {
      for (const l of satellites) {
        const parent = byId.get((l as LeafNode).parentId);
        if (!parent) continue;
        const dx = (l.x ?? 0) - (parent.x ?? 0);
        const dy = (l.y ?? 0) - (parent.y ?? 0);
        const r = Math.hypot(dx, dy) || 1e-6;
        const strength = parentKindOf(l) === "hub" ? 0.45 : 1.3;
        const k = (((l.targetR ?? 70) - r) / r) * strength * alpha;
        l.vx = (l.vx ?? 0) + dx * k;
        l.vy = (l.vy ?? 0) + dy * k;
      }
    }
    (orbit as unknown as { initialize: () => void }).initialize = () => {};

    const links = graph.links.map((e) => ({ ...e }));

    const sim: Simulation<GraphNode, undefined> = forceSimulation(nodes)
      .force(
        "link",
        forceLink<GraphNode, (typeof links)[number]>(links)
          .id((d) => d.id)
          .distance((e) => (e.kind === "spoke" ? HUB_RING : 0))
          .strength((e) => (e.kind === "spoke" ? 0.9 : 0.02)),
      )
      .force(
        "charge",
        forceManyBody<GraphNode>().strength((d) =>
          d.kind === "hub" ? -460
            : d.kind === "center" ? -200
            : d.kind === "category" ? -160
            : tightParent(d) ? -4
            : -42,
        ),
      )
      .force("hubRadial", forceRadial<GraphNode>(HUB_RING, CX, CY).strength((d) => (d.kind === "hub" ? 0.92 : 0)))
      .force("leaf", orbit as never)
      .force(
        "collide",
        forceCollide<GraphNode>()
          .radius((d) => (d.r ?? 8) + (d.kind === "leaf" ? (tightParent(d) ? 1.5 : 3) : 7))
          .strength(0.85),
      )
      .stop();

    // Settle synchronously (no per-frame React re-render) — then render once.
    for (let i = 0; i < 360 && sim.alpha() > 0.015; i++) sim.tick();
    sim.stop();
    const snap = new Map<string, { x: number; y: number }>();
    for (const n of nodes) {
      if (n.kind !== "center") { n.fx = n.x; n.fy = n.y; }
      snap.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
    }
    globalPosRef.current = snap;
    forceFrame((f) => f + 1);
    return () => { sim.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  const nodes = nodesRef.current;
  const hubById = useMemo(() => new Map(nodes.filter((n) => n.kind === "hub").map((n) => [n.id, n])), [nodes]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const leafById = useMemo(() => new Map(graph.leaves.map((l) => [l.id, l])), [graph]);
  // entities grouped under each category bubble
  const membersByCategory = useMemo(() => {
    const m = new Map<string, LeafNode[]>();
    for (const l of graph.leaves)
      if (l.parentKind === "category") (m.get(l.parentId) ?? m.set(l.parentId, []).get(l.parentId)!).push(l);
    return m;
  }, [graph]);
  // leaves that anchor a sub-cluster (something is re-parented onto them)
  const subHubIds = useMemo(
    () => new Set(graph.leaves.filter((l) => l.parentKind === "leaf").map((l) => l.parentId)),
    [graph],
  );

  function selectById(id: string) {
    const leaf = leafById.get(id);
    if (leaf) setSelection({ kind: "leaf", node: leaf });
  }

  // ---- zoom / pan plumbing (instant view changes; CSS animates morphs) ----
  const clampK = (k: number) => Math.max(0.35, Math.min(5, k));
  function applyView(v: { k: number; x: number; y: number }, animate = false) {
    setSmooth(animate);
    viewRef.current = v;
    setView(v);
  }
  function zoomBy(factor: number) {
    const cur = viewRef.current;
    const k = clampK(cur.k * factor);
    const cx = VW / 2, cy = VH / 2;
    applyView({ k, x: cx - (k / cur.k) * (cx - cur.x), y: cy - (k / cur.k) * (cy - cur.y) }, true);
  }
  // Move nodes to new positions; CSS transitions animate the morph. Edges hide briefly.
  function applyPositions(targets: Map<string, { x: number; y: number }>) {
    for (const n of nodes) {
      const t = targets.get(n.id);
      if (t) { n.x = t.x; n.y = t.y; }
    }
    setMorphing(true);
    clearTimeout(morphTimer.current);
    morphTimer.current = window.setTimeout(() => setMorphing(false), 520);
    forceFrame((f) => f + 1);
  }
  function resetView() {
    setFocused(null);
    if (globalPosRef.current.size) applyPositions(globalPosRef.current);
    applyView({ k: 1, x: 0, y: 0 }, true);
  }

  // Deterministic radial layout for one isolated cluster: hub centered, its category
  // bubbles / sub-hubs on a ring, each bubble's members fanned on their own ring —
  // spaced generously so nodes don't pile up. Returns target positions (camera fits them).
  function computeFocusLayout(companyId: string): Map<string, { x: number; y: number }> | null {
    const cluster = nodes.filter((n) => n.kind !== "center" && n.companyId === companyId);
    const hub = cluster.find((n) => n.kind === "hub");
    if (!hub) return null;
    const out = new Map<string, { x: number; y: number }>();
    out.set(hub.id, { x: CX, y: CY });

    // wider rings now that every member shows a label (needs room, not just the dot)
    const kidRing = (n: number) => (n <= 1 ? 0 : Math.max(96, (n * 74) / (2 * Math.PI)));
    const hubChildren = cluster.filter((n) => n.kind !== "hub" && (n as LeafNode).parentKind === "hub");
    const kidsOf = (id: string) => cluster.filter((k) => (k as LeafNode).parentId === id);
    const nH = Math.max(1, hubChildren.length);
    const maxKid = Math.max(0, ...hubChildren.map((c) => kidRing(kidsOf(c.id).length)));
    // ring large enough that neighbouring bubbles' member-rings don't collide
    const hubRing = Math.max(230, (nH * 185) / (2 * Math.PI), maxKid * 1.95 + 170);

    hubChildren.forEach((c, i) => {
      const a = (i / nH) * 2 * Math.PI - Math.PI / 2;
      const px = CX + hubRing * Math.cos(a);
      const py = CY + hubRing * Math.sin(a);
      out.set(c.id, { x: px, y: py });
      const kids = kidsOf(c.id);
      const kr = kidRing(kids.length);
      if (kids.length === 1) {
        out.set(kids[0].id, { x: px + 82 * Math.cos(a), y: py + 82 * Math.sin(a) });
      } else {
        kids.forEach((k, j) => {
          const ka = (j / kids.length) * 2 * Math.PI - Math.PI / 2;
          out.set(k.id, { x: px + kr * Math.cos(ka), y: py + kr * Math.sin(ka) });
        });
      }
    });
    return out;
  }

  // Isolate the clicked cluster: hub dead-center, relations fanned around it, the
  // Watchlist spoke and other clusters hidden, camera fit to the cluster.
  function focusCluster(companyId: string) {
    setFocused(companyId);
    const targets = computeFocusLayout(companyId);
    if (!targets) return;
    applyPositions(targets);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [, p] of targets) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    const pad = 90;
    const k = clampK(Math.min(VW / (maxX - minX + pad * 2), VH / (maxY - minY + pad * 2)));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    applyView({ k, x: VW / 2 - k * cx, y: VH / 2 - k * cy }, true);
  }

  function toVB(clientX: number, clientY: number) {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }
  function onPanStart(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    const p = toVB(e.clientX, e.clientY);
    if (!p) return;
    setSmooth(false);
    panRef.current = { x0: p.x, y0: p.y, vx: viewRef.current.x, vy: viewRef.current.y, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onPanMove(e: ReactPointerEvent) {
    const pan = panRef.current;
    if (!pan) return;
    const p = toVB(e.clientX, e.clientY);
    if (!p) return;
    const dx = p.x - pan.x0, dy = p.y - pan.y0;
    if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
    applyView({ k: viewRef.current.k, x: pan.vx + dx, y: pan.vy + dy });
  }
  function onPanEnd(e: ReactPointerEvent) {
    const pan = panRef.current;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    panRef.current = null;
    if (pan?.moved) suppressClickRef.current = true; // a drag shouldn't deselect
  }
  function onBackgroundClick() {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setSelection(null);
    resetView();
  }

  // Wheel zoom, anchored at the cursor. Registered non-passive so we can preventDefault.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toVB(e.clientX, e.clientY);
      if (!p) return;
      const cur = viewRef.current;
      const k = clampK(cur.k * Math.exp(-e.deltaY * 0.0015));
      applyView({ k, x: p.x - (k / cur.k) * (p.x - cur.x), y: p.y - (k / cur.k) * (p.y - cur.y) }); // animate=false
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => clearTimeout(morphTimer.current), []);

  // ---- filter / emphasis ----
  const q = query.trim().toLowerCase();
  const allDims = activeDims.size === graph.dimensions.length;

  function leafPassesDim(l: LeafNode) {
    return allDims || l.dimensions.some((d) => activeDims.has(d));
  }
  function leafVisible(l: LeafNode) {
    return showLeaves && leafPassesDim(l);
  }
  // company matches search if its name, a leaf entity, or a category label matches
  const matchCompany = useMemo(() => {
    if (!q) return null;
    const set = new Set<string>();
    for (const h of graph.hubs) if (h.name.toLowerCase().includes(q)) set.add(h.companyId);
    for (const l of graph.leaves) if (l.name.toLowerCase().includes(q)) set.add(l.companyId);
    for (const c of graph.categories) if (c.label.toLowerCase().includes(q)) set.add(c.companyId);
    return set;
  }, [q, graph]);

  const focusCompany = hoverCompany ?? selection?.node.companyId ?? null;

  function dimNode(node: GraphNode): boolean {
    if (node.kind === "center") return false;
    if (focusCompany && node.companyId !== focusCompany) return true;
    if (matchCompany && !matchCompany.has(node.companyId!)) return true;
    if (q && node.kind === "leaf" && !node.name.toLowerCase().includes(q)) {
      // keep leaves of a matched company faintly visible but de-emphasised
      return true;
    }
    return false;
  }

  const selectedId = selection?.node.id ?? null;

  // ---- render ----
  return (
    <div className="cl-root">
      <ControlBar
        query={query}
        setQuery={setQuery}
        dims={graph.dimensions}
        activeDims={activeDims}
        setActiveDims={setActiveDims}
        showLeaves={showLeaves}
        setShowLeaves={setShowLeaves}
        hubCount={graph.hubs.length}
        leafCount={graph.leaves.length}
      />

      <div className="cl-body">
        <div className="cl-canvas">
          <svg ref={svgRef} viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet" className="cl-svg">
            {/* pan / deselect surface (behind everything) */}
            <rect x={0} y={0} width={VW} height={VH} fill="transparent"
              className="cl-pan-surface"
              onPointerDown={onPanStart}
              onPointerMove={onPanMove}
              onPointerUp={onPanEnd}
              onClick={onBackgroundClick} />

            <g style={{
              transform: `translate(${view.x}px,${view.y}px) scale(${view.k})`,
              transition: smooth ? "transform 0.5s ease" : "none",
            }}>

            {/* edges (hidden mid-morph so they don't lag behind gliding nodes) */}
            <g style={{ opacity: morphing ? 0 : 1, transition: "opacity 0.2s ease" }}>
              {graph.links.map((e) => {
                const s = nodeById.get(e.source);
                const t = nodeById.get(e.target);
                if (!s || !t) return null;
                if (focused) {
                  if (e.kind === "spoke") return null; // no Watchlist link when isolated
                  if (e.companyId !== focused) return null;
                }
                if (e.kind === "leaf") {
                  if (!showLeaves) return null;
                  if (s.kind === "leaf" && !leafPassesDim(s as LeafNode)) return null;
                  if (t.kind === "leaf" && !leafPassesDim(t as LeafNode)) return null;
                }
                const dimmed =
                  (focusCompany && e.companyId !== focusCompany) ||
                  (matchCompany && !matchCompany.has(e.companyId));
                const hot = focusCompany && e.companyId === focusCompany;
                const hue = hubById.get(e.companyId)?.hue;
                return (
                  <line
                    key={`${e.source}-${e.target}`}
                    x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                    stroke={hot && hue != null ? clusterEdge(hue) : INK_EDGE}
                    strokeWidth={hot ? 1.6 : 1}
                    opacity={dimmed ? 0.18 : 1}
                  />
                );
              })}
            </g>

            {/* relation connectors (person → firm etc.) — only for the focused cluster */}
            {showLeaves && focusCompany && !morphing && (
              <g>
                {graph.relations
                  .filter((rel) => rel.companyId === focusCompany)
                  // the primary relation is already drawn as the structural parent edge
                  .filter((rel) => leafById.get(rel.source)?.parentId !== rel.target)
                  .map((rel) => {
                    const s = nodeById.get(rel.source);
                    const t = nodeById.get(rel.target);
                    if (!s || !t) return null;
                    const sl = leafById.get(rel.source);
                    const tl = leafById.get(rel.target);
                    if (sl && !leafPassesDim(sl)) return null;
                    if (tl && !leafPassesDim(tl)) return null;
                    const hue = hubById.get(rel.companyId)?.hue ?? 0;
                    return (
                      <line
                        key={`rel-${rel.source}-${rel.target}`}
                        x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                        stroke={clusterEdge(hue)}
                        strokeWidth={1.4}
                        strokeDasharray="4 4"
                        opacity={0.7}
                      />
                    );
                  })}
              </g>
            )}

            {/* category bubbles (role-type groups: Investors, Regulators …) */}
            <g>
              {nodes.filter((n) => n.kind === "category").map((n) => {
                const c = n as CategoryNode & GraphNode;
                if (focused && c.companyId !== focused) return null;
                const dimmed = dimNode(n);
                const isSel = selectedId === c.id;
                return (
                  <g key={c.id}
                    style={{ transform: `translate(${c.x}px,${c.y}px)` }}
                    className="cl-node"
                    opacity={dimmed ? 0.16 : 1}
                    onMouseEnter={() => setHoverCompany(c.companyId)}
                    onMouseLeave={() => setHoverCompany(null)}
                    onClick={(ev) => { ev.stopPropagation(); setSelection({ kind: "category", node: c }); focusCluster(c.companyId); }}>
                    <circle r={c.r} fill={categoryFill(c.hue)}
                      stroke={isSel ? hubFill(c.hue) : clusterEdge(c.hue)} strokeWidth={isSel ? 2.5 : 1.5} />
                    <g transform={`translate(${(c.r ?? 16) * 0.72},${-(c.r ?? 16) * 0.72})`}>
                      <circle r={8} fill={hubFill(c.hue)} />
                      <text className="cl-badge" textAnchor="middle" dy="3.2">{c.count}</text>
                    </g>
                    <text className="cl-cat-label" textAnchor="middle" dy={(c.r ?? 16) + 13}>{c.label}</text>
                  </g>
                );
              })}
            </g>

            {/* leaf nodes */}
            <g>
              {nodes.filter((n) => n.kind === "leaf").map((n) => {
                const l = n as LeafNode & GraphNode;
                if (focused && l.companyId !== focused) return null;
                if (!leafVisible(l)) return null;
                const dimmed = dimNode(n);
                const isSel = selectedId === l.id;
                const isSubHub = subHubIds.has(l.id);
                return (
                  <g key={l.id}
                    style={{ transform: `translate(${l.x}px,${l.y}px)` }}
                    className="cl-node"
                    opacity={dimmed ? 0.12 : 1}
                    onMouseEnter={() => { setHoverCompany(l.companyId); setHoverNodeId(l.id); }}
                    onMouseLeave={() => { setHoverCompany(null); setHoverNodeId(null); }}
                    onClick={(ev) => { ev.stopPropagation(); setSelection({ kind: "leaf", node: l }); focusCluster(l.companyId); }}>
                    <circle r={l.r} fill={isSubHub ? subHubFill(l.hue) : leafFill(l.hue)}
                      stroke={isSel ? hubFill(l.hue) : "none"} strokeWidth={isSel ? 2.5 : 0} />
                    {l.count > 1 && (
                      <g transform={`translate(${(l.r ?? 8) * 0.72},${-(l.r ?? 8) * 0.72})`}>
                        <circle r={8} fill={hubFill(l.hue)} />
                        <text className="cl-badge" textAnchor="middle" dy="3.2">{l.count}</text>
                      </g>
                    )}
                    {(focused != null || hoverNodeId === l.id || isSel) && (
                      <text className="cl-leaf-label" textAnchor="middle" dy={(l.r ?? 8) + 13}>
                        {l.name.length > 24 ? l.name.slice(0, 22) + "…" : l.name}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>

            {/* hub nodes */}
            <g>
              {nodes.filter((n) => n.kind === "hub").map((n) => {
                const h = n as HubNode & GraphNode;
                if (focused && h.companyId !== focused) return null;
                const dimmed = dimNode(n);
                const isSel = selectedId === h.id;
                return (
                  <g key={h.id}
                    style={{ transform: `translate(${h.x}px,${h.y}px)` }}
                    className="cl-node"
                    opacity={dimmed ? 0.18 : 1}
                    onMouseEnter={() => setHoverCompany(h.companyId)}
                    onMouseLeave={() => setHoverCompany(null)}
                    onClick={(ev) => { ev.stopPropagation(); setSelection({ kind: "hub", node: h }); focusCluster(h.companyId); }}>
                    <circle r={h.r} fill={hubFill(h.hue)}
                      stroke={isSel ? "#241F18" : "none"} strokeWidth={isSel ? 2.5 : 0} />
                    <text className="cl-hub-label" textAnchor="middle" dy={(h.r ?? 20) + 15}>
                      {h.name.length > 26 ? h.name.slice(0, 24) + "…" : h.name}
                    </text>
                  </g>
                );
              })}
            </g>

            {/* center (hidden while a single cluster is isolated) */}
            {!focused && (
              <g transform={`translate(${CX},${CY})`} className="cl-node"
                onClick={(ev) => { ev.stopPropagation(); setSelection(null); resetView(); }}>
                <circle r={42} fill="#241F18" />
                <text className="cl-center-label" textAnchor="middle" dy="4">WATCHLIST</text>
              </g>
            )}

            </g>{/* /zoom group */}
          </svg>

          {/* zoom controls */}
          <div className="cl-zoom-ctrls">
            <button title="Zoom in" onClick={() => zoomBy(1.4)}>+</button>
            <button title="Zoom out" onClick={() => zoomBy(1 / 1.4)}>−</button>
            <button title="Reset view" className="cl-zoom-reset" onClick={resetView}>⤢</button>
          </div>
        </div>

        <DetailPanel
          selection={selection}
          graph={graph}
          membersByCategory={membersByCategory}
          onSelectHub={(h) => { setSelection({ kind: "hub", node: h }); focusCluster(h.companyId); }}
          onSelectLeafById={selectById}
          onHoverCompany={setHoverCompany}
        />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
function ControlBar({
  query, setQuery, dims, activeDims, setActiveDims, showLeaves, setShowLeaves, hubCount, leafCount,
}: {
  query: string; setQuery: (v: string) => void;
  dims: string[]; activeDims: Set<string>; setActiveDims: (s: Set<string>) => void;
  showLeaves: boolean; setShowLeaves: (v: boolean) => void;
  hubCount: number; leafCount: number;
}) {
  const [open, setOpen] = useState(false);
  function toggleDim(d: string) {
    const next = new Set(activeDims);
    if (next.has(d)) next.delete(d); else next.add(d);
    setActiveDims(next);
  }
  const allOn = activeDims.size === dims.length;
  return (
    <div className="cl-controls">
      <div className="cl-field">
        <input
          className="cl-search"
          placeholder="Search companies or entities…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="cl-dim-wrap">
        <button className="cl-dim-btn" onClick={() => setOpen((o) => !o)}>
          Dimensions {allOn ? "· all" : `· ${activeDims.size}/${dims.length}`} ▾
        </button>
        {open && (
          <div className="cl-dim-menu" onMouseLeave={() => setOpen(false)}>
            <button className="cl-dim-all" onClick={() => setActiveDims(new Set(allOn ? [] : dims))}>
              {allOn ? "Clear all" : "Select all"}
            </button>
            {dims.map((d) => (
              <label key={d} className="cl-dim-row">
                <input type="checkbox" checked={activeDims.has(d)} onChange={() => toggleDim(d)} />
                <span className="cl-dim-swatch" style={{ background: `hsl(${dimensionHue(d)} 55% 50%)` }} />
                {dimensionLabel(d)}
              </label>
            ))}
          </div>
        )}
      </div>

      <label className="cl-toggle">
        <input type="checkbox" checked={showLeaves} onChange={(e) => setShowLeaves(e.target.checked)} />
        Show entities
      </label>

      <div className="cl-stat">{hubCount} companies · {leafCount} entities</div>
    </div>
  );
}

// ----------------------------------------------------------------------------
function DetailPanel({
  selection, graph, membersByCategory, onSelectHub, onSelectLeafById, onHoverCompany,
}: {
  selection: Selection;
  graph: NonNullable<ReturnType<typeof buildGraph>>;
  membersByCategory: Map<string, LeafNode[]>;
  onSelectHub: (h: HubNode) => void;
  onSelectLeafById: (id: string) => void;
  onHoverCompany: (c: string | null) => void;
}) {
  if (!selection) {
    const totalArticles = graph.hubs.reduce((s, h) => s + h.articles.length, 0);
    return (
      <aside className="cl-panel">
        <div className="cl-panel-eyebrow">Clusters view</div>
        <h2 className="cl-panel-title">Watchlist signal map</h2>
        <p className="cl-panel-lead">
          One hub per company. Named entities group into role-type bubbles — Investors,
          Regulators, Partners — that open to the detailed names. Click any node to drill in.
        </p>
        <div className="cl-overview-stats">
          <Stat label="Companies" value={graph.hubs.length} />
          <Stat label="Groups" value={graph.categories.length} />
          <Stat label="Entities" value={graph.leaves.length} />
          <Stat label="Articles" value={totalArticles} />
        </div>
        <div className="cl-legend-head">Clusters</div>
        <div className="cl-legend">
          {[...graph.hubs].sort((a, b) => b.keptCount - a.keptCount).map((h) => (
            <button key={h.id} className="cl-legend-row"
              onMouseEnter={() => onHoverCompany(h.companyId)}
              onMouseLeave={() => onHoverCompany(null)}
              onClick={() => onSelectHub(h)}>
              <span className="cl-legend-dot" style={{ background: hubFill(h.hue) }} />
              <span className="cl-legend-name">{h.name}</span>
              <span className="cl-legend-count">{h.keptCount}</span>
            </button>
          ))}
        </div>
      </aside>
    );
  }

  if (selection.kind === "hub") return <HubPanel hub={selection.node} />;
  if (selection.kind === "category")
    return (
      <CategoryPanel
        category={selection.node}
        members={membersByCategory.get(selection.node.id) ?? []}
        hubName={graph.hubs.find((h) => h.id === selection.node.hubId)?.name}
        onSelectLeafById={onSelectLeafById}
      />
    );
  return (
    <LeafPanel
      leaf={selection.node}
      hubName={graph.hubs.find((h) => h.id === selection.node.hubId)?.name}
      onSelectLeafById={onSelectLeafById}
    />
  );
}

function CategoryPanel({
  category, members, hubName, onSelectLeafById,
}: {
  category: CategoryNode;
  members: LeafNode[];
  hubName?: string;
  onSelectLeafById: (id: string) => void;
}) {
  const sorted = [...members].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return (
    <aside className="cl-panel">
      <div className="cl-panel-eyebrow" style={{ color: hubFill(category.hue) }}>
        {category.label}{hubName ? ` · ${hubName}` : ""}
      </div>
      <h2 className="cl-panel-title">
        {category.label} <span className="cl-count-tag">({members.length} entit{members.length === 1 ? "y" : "ies"})</span>
      </h2>
      <p className="cl-panel-lead">Entities whose role marks them as {category.label.toLowerCase()} for this company.</p>
      <div className="cl-legend">
        {sorted.map((m) => (
          <button key={m.id} className="cl-legend-row" onClick={() => onSelectLeafById(m.id)}>
            <span className="cl-legend-dot" style={{ background: leafFill(m.hue) }} />
            <span className="cl-legend-name">
              {m.name}
              {m.roles[0] && <span className="cl-legend-role"> — {m.roles[0]}</span>}
            </span>
            <span className="cl-legend-count">{m.count}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="cl-stat-card">
      <div className="cl-stat-num">{value}</div>
      <div className="cl-stat-label">{label}</div>
    </div>
  );
}

function HubPanel({ hub }: { hub: HubNode }) {
  // group company articles by dimension
  const groups = useMemo(() => {
    const m = new Map<string, ArticleRef[]>();
    for (const a of hub.articles) {
      if (!m.has(a.dimension)) m.set(a.dimension, []);
      m.get(a.dimension)!.push(a);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [hub]);

  return (
    <aside className="cl-panel">
      <div className="cl-panel-eyebrow" style={{ color: hubFill(hub.hue) }}>Company hub</div>
      <h2 className="cl-panel-title">{hub.name}</h2>
      <div className="cl-panel-meta">
        {hub.articles.length} articles<span className="cl-sep">|</span>
        {hub.keptCount} kept<span className="cl-sep">|</span>
        {hub.articlesScreened} screened
      </div>
      {groups.map(([dim, arts]) => (
        <section key={dim} className="cl-group">
          <div className="cl-group-head">
            <DimTag dim={dim} />
            <span className="cl-group-count">{arts.length}</span>
          </div>
          {arts.map((a, i) => <ArticleRow key={a.url + i} a={a} />)}
        </section>
      ))}
    </aside>
  );
}

function LeafPanel({
  leaf, hubName, onSelectLeafById,
}: {
  leaf: LeafNode;
  hubName?: string;
  onSelectLeafById: (id: string) => void;
}) {
  const otherAliases = leaf.aliases.filter((a) => a.trim() !== leaf.name.trim());
  return (
    <aside className="cl-panel">
      <div className="cl-panel-eyebrow" style={{ color: hubFill(leaf.hue) }}>
        {leaf.category ? categoryLabel(leaf.category) : "Entity"}{hubName ? ` · ${hubName}` : ""}
      </div>
      <h2 className="cl-panel-title">
        {leaf.name} <span className="cl-count-tag">({leaf.count} article{leaf.count === 1 ? "" : "s"})</span>
      </h2>
      {otherAliases.length > 0 && (
        <div className="cl-aliases">also: {otherAliases.join(" · ")}</div>
      )}
      {leaf.related.length > 0 && (
        <div className="cl-related">
          <span className="cl-related-label">Linked to</span>
          {leaf.related.map((r) => (
            <button key={r.id} className="cl-related-chip" style={{ borderColor: hubFill(leaf.hue) }}
              onClick={() => onSelectLeafById(r.id)}>
              {r.name} ↗
            </button>
          ))}
        </div>
      )}
      {leaf.roles.length > 0 && (
        <div className="cl-roles">
          {leaf.roles.map((r) => <span key={r} className="cl-role">{r}</span>)}
        </div>
      )}
      <div className="cl-group">
        {leaf.articles.map((a, i) => <ArticleRow key={a.url + i} a={a} />)}
      </div>
    </aside>
  );
}

function ArticleRow({ a }: { a: ArticleRef }) {
  const [open, setOpen] = useState(false);
  const date = (a.published_at || "").slice(0, 10);
  return (
    <article className="cl-article">
      <div className="cl-article-top">
        <a className="cl-article-title" href={a.url} target="_blank" rel="noreferrer"
          onClick={(e) => e.stopPropagation()}>
          {a.title}
        </a>
      </div>
      <div className="cl-article-meta">
        <DimTag dim={a.dimension} small />
        <span className="cl-sep">|</span>
        <span className="cl-source">{a.source}</span>
        <span className="cl-sep">|</span>
        <span>{date}</span>
      </div>
      {a.summary && <p className="cl-article-summary">{a.summary}</p>}
      {a.full_text && (
        <>
          <button className="cl-expand" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide full text" : "Read full text"}
          </button>
          <div className={`cl-grid-anim ${open ? "open" : ""}`}>
            <div className="cl-grid-min">
              <p className="cl-fulltext">{a.full_text}</p>
            </div>
          </div>
        </>
      )}
    </article>
  );
}

function DimTag({ dim, small }: { dim: string; small?: boolean }) {
  const h = dimensionHue(dim);
  return (
    <span className={`cl-dimtag${small ? " sm" : ""}`}
      style={{
        color: `hsl(${h} 55% 32%)`,
        background: `hsl(${h} 60% 50% / 0.14)`,
        borderColor: `hsl(${h} 50% 50% / 0.45)`,
      }}>
      {dimensionLabel(dim)}
    </span>
  );
}
