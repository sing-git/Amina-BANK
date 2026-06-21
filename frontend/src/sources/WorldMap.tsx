// WorldMap — 3D dotted globe matching AMINA website aesthetic.
// White globe surface, gray hex-dot continents, colorful location markers.
import { useCallback, useEffect, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import "./sources.css";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import world from "world-atlas/countries-110m.json";

const COUNTRIES_FEATURES = (
  feature(world as unknown as Topology, (world as any).objects.countries) as any
).features as object[];

const POINT_PALETTE = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#f59e0b", // amber
  "#10b981", // emerald
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
  "#84cc16", // lime
  "#6366f1", // indigo
];

/* ── Data shapes ─────────────────────────────────────────────────── */
export interface MapPoint {
  id: string;
  name: string;
  coordinates: [number, number]; // [lng, lat]
  count: number;
  byCategory?: { news: number; sanctions: number; registry: number };
  rows?: string[];
}
export interface MapLink {
  id: string;
  title: string;
  from: [number, number];
  to: [number, number];
}
interface WorldMapProps {
  points?: MapPoint[];
  links?: MapLink[];
  regions?: { label: string; count: number }[];
}

const REGION_CATEGORY: Record<string, "news" | "sanctions" | "registry"> = {
  "News feeds": "news",
  "Sanctions lists": "sanctions",
  "Corporate registries": "registry",
};

/* ── Small pieces ────────────────────────────────────────────────── */
function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="src-card">
      <p className="src-card-label">{label}</p>
      <p className="src-card-value">{value}</p>
    </div>
  );
}

function SourceTypePanel({
  regions,
  selected,
  onSelect,
  onClear,
}: {
  regions: { label: string; count: number }[];
  selected: string;
  onSelect: (r: string) => void;
  onClear: () => void;
}) {
  return (
    <aside className="src-filter">
      <div className="src-filter-head">
        <div>
          <p className="src-filter-eyebrow">Filter</p>
          <h2 className="src-filter-title">Source type</h2>
        </div>
        <button type="button" onClick={onClear} disabled={!selected} className="src-filter-all">
          All
        </button>
      </div>
      <div className="src-pills">
        {regions.length > 0 ? (
          regions.map((r) => {
            const isSel = selected === r.label;
            return (
              <button
                key={r.label}
                type="button"
                onClick={() => onSelect(r.label)}
                className={isSel ? "src-pill src-pill-on" : "src-pill"}
              >
                <span className="src-pill-label">{r.label}</span>
                <span className="src-pill-count">{r.count}</span>
              </button>
            );
          })
        ) : (
          <span className="src-empty">No sources.</span>
        )}
      </div>
    </aside>
  );
}

/* ── Globe point shape ───────────────────────────────────────────── */
interface GlobePoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  displayCount: number;
  rows: string[];
  color: string;
}

/* ── Main component ──────────────────────────────────────────────── */
export default function WorldMap({ points = [], links = [], regions = [] }: WorldMapProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 520 });
  const [selectedRegion, setSelectedRegion] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Track container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setDims({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    obs.observe(el);
    setDims({ w: el.clientWidth, h: el.clientHeight });
    return () => obs.disconnect();
  }, []);

  // On globe mount: start rotation + make globe surface white
  const onGlobeReady = useCallback(() => {
    const gl = globeRef.current;
    if (!gl) return;

    const ctrl = gl.controls();
    if (ctrl) {
      ctrl.autoRotate = true;
      ctrl.autoRotateSpeed = 0.4;
    }

    // Access Three.js scene and make the base globe sphere white
    const glAny = gl as any;
    const scene = glAny.scene?.();
    if (scene) {
      scene.traverse((obj: any) => {
        if (obj.isMesh && obj.material && obj.geometry) {
          const mat = obj.material;
          // Target the main sphere (no texture map, has color property)
          if (!mat.map && mat.color && mat.type !== "LineBasicMaterial") {
            mat.color.set(0xffffff);
            mat.needsUpdate = true;
          }
        }
      });
    }
  }, []);

  // Filter logic
  const activeCat = selectedRegion ? REGION_CATEGORY[selectedRegion] : null;
  const visiblePoints = activeCat
    ? points.filter((p) => (p.byCategory?.[activeCat] ?? 0) > 0)
    : points;
  const countOf = (p: MapPoint) =>
    activeCat ? (p.byCategory?.[activeCat] ?? 0) : p.count;
  const rowsOf = (p: MapPoint): string[] =>
    activeCat ? [`${countOf(p)} ${selectedRegion.toLowerCase()}`] : p.rows ?? [`${p.count} sources`];
  const totalRecords = visiblePoints.reduce((s, p) => s + countOf(p), 0);

  const globeData: GlobePoint[] = visiblePoints.map((p, i) => ({
    id: p.id,
    name: p.name,
    lat: p.coordinates[1],
    lng: p.coordinates[0],
    displayCount: countOf(p),
    rows: rowsOf(p),
    color: POINT_PALETTE[i % POINT_PALETTE.length],
  }));

  const arcData = links.map((l) => ({
    id: l.id,
    title: l.title,
    startLat: l.from[1],
    startLng: l.from[0],
    endLat: l.to[1],
    endLng: l.to[0],
  }));

  function handlePointClick(point: object) {
    const p = point as GlobePoint;
    setSelectedId(p.id);
    globeRef.current?.pointOfView({ lat: p.lat, lng: p.lng, altitude: 1.4 }, 900);
    const ctrl = globeRef.current?.controls();
    if (ctrl) ctrl.autoRotate = false;
  }

  function reset() {
    setSelectedId(null);
    globeRef.current?.pointOfView({ lat: 20, lng: 0, altitude: 2.5 }, 800);
    const ctrl = globeRef.current?.controls();
    if (ctrl) {
      ctrl.autoRotate = true;
      ctrl.autoRotateSpeed = 0.4;
    }
  }

  function handleRegionChange(r: string) {
    setSelectedRegion((cur) => (cur === r ? "" : r));
    reset();
  }

  return (
    <section className="src-root">
      {/* Header */}
      <div className="src-head">
        <div>
          <p className="src-eyebrow">Intelligence feeds</p>
          <h1 className="src-title">Sources</h1>
        </div>
        <span className="src-badge">{points.length} countries</span>
      </div>

      {/* Metric row */}
      <div className="src-metrics">
        <MetricCard label="Source countries" value={visiblePoints.length} />
        <MetricCard label="Source records" value={totalRecords} />
        <MetricCard label="Active type" value={selectedRegion || "All"} />
        <MetricCard label="Selected" value={selectedId ?? "—"} />
      </div>

      {/* Globe panel */}
      <div className="src-map-wrap">
        <div ref={containerRef} className="src-map src-map-globe">
          {dims.w > 0 && (
            <Globe
              ref={globeRef}
              width={dims.w}
              height={dims.h}
              /* White globe, no night sky */
              globeImageUrl=""
              backgroundColor="rgba(255,255,255,0)"
              /* No atmosphere — matches reference */
              showAtmosphere={false}
              /* Dotted landmass via hex polygons — resolution 4 = small, dense dots */
              hexPolygonsData={COUNTRIES_FEATURES}
              hexPolygonResolution={4}
              hexPolygonMargin={0.3}
              hexPolygonAltitude={0.002}
              hexPolygonColor={() => "#bfc9d2"}
              /* Colorful location markers */
              pointsData={globeData}
              pointLat="lat"
              pointLng="lng"
              pointColor={(d) =>
                selectedId === (d as GlobePoint).id ? "#ffffff" : (d as GlobePoint).color
              }
              pointAltitude={0.04}
              pointRadius={(d) => (selectedId === (d as GlobePoint).id ? 0.55 : 0.38)}
              pointLabel={(d) => {
                const p = d as GlobePoint;
                return `<div style="background:rgba(255,255,255,0.96);color:#0a0a0a;border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;font-family:Inter,ui-sans-serif,sans-serif;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,0.10);pointer-events:none"><b style="font-size:14px">${p.name}</b><br/>${p.rows.join("<br/>")}</div>`;
              }}
              onPointClick={handlePointClick}
              onGlobeReady={onGlobeReady}
              /* Arcs */
              arcsData={arcData}
              arcStartLat="startLat"
              arcStartLng="startLng"
              arcEndLat="endLat"
              arcEndLng="endLng"
              arcColor={() => ["rgba(20,184,166,0.5)", "rgba(99,102,241,0.5)"]}
              arcAltitudeAutoScale={0.35}
              arcStroke={0.4}
            />
          )}

          {/* Floating overlay */}
          <div className="src-overlay">
            <SourceTypePanel
              regions={regions}
              selected={selectedRegion}
              onSelect={handleRegionChange}
              onClear={() => { setSelectedRegion(""); reset(); }}
            />
            {selectedId && (
              <button type="button" onClick={reset} className="src-reset">
                Reset view
              </button>
            )}
          </div>
        </div>
        <p className="src-note">
          Origin inferred from source domain, sanctions issuer, and registry jurisdiction. Drag to rotate · scroll to zoom · click a point to focus.
        </p>
      </div>
    </section>
  );
}
