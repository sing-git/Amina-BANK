// WorldMap — data-source provenance map (warm-paper theme, plain CSS via sources.css).
// Adapted from the supplied Tailwind component: same map/zoom/tooltip logic, classes converted
// to scoped CSS, and the left-panel filter wired to filter points by SOURCE TYPE.
import { useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Line,
  Marker,
  ZoomableGroup,
} from "react-simple-maps";
import countries110m from "world-atlas/countries-110m.json";
import "./sources.css";

const worldTopology = countries110m as Record<string, unknown>;

/* ── Warm paper palette (the brand) ────────────────────────────── */
const COLOR = {
  land: "#E7DFCF",
  landHover: "#DCD2BE",
  landStroke: "rgba(133, 123, 104, 0.4)",
  accentStrokeSel: "#fecaca",
  marker: "#ef4444",
  markerSel: "#fb7185",
};

/* ── Data shapes ───────────────────────────────────────────────── */
export interface MapPoint {
  id: string;
  name: string;
  coordinates: [number, number]; // [lng, lat]
  count: number;
  byCategory?: { news: number; sanctions: number; registry: number };
  rows?: string[]; // tooltip detail lines
}
export interface MapLink {
  id: string;
  title: string;
  from: [number, number];
  to: [number, number];
}
interface TooltipState {
  title: string;
  rows: string[];
  x: number;
  y: number;
}
interface WorldMapProps {
  points?: MapPoint[];
  links?: MapLink[];
  regions?: { label: string; count: number }[];
}

// Source-type filter label → the category key on a point.
const REGION_CATEGORY: Record<string, "news" | "sanctions" | "registry"> = {
  "News feeds": "news",
  "Sanctions lists": "sanctions",
  "Corporate registries": "registry",
};

/* ── Small pieces ──────────────────────────────────────────────── */
function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="src-card">
      <p className="src-card-label">{label}</p>
      <p className="src-card-value">{value}</p>
    </div>
  );
}

function Tooltip({ tooltip }: { tooltip: TooltipState | null }) {
  if (!tooltip) return null;
  return (
    <div className="src-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
      <p className="src-tooltip-title">{tooltip.title}</p>
      <div className="src-tooltip-rows">
        {tooltip.rows.map((row) => (
          <p key={row}>{row}</p>
        ))}
      </div>
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

/* ── Main component ────────────────────────────────────────────── */
export default function WorldMap({ points = [], links = [], regions = [] }: WorldMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState("");
  const [center, setCenter] = useState<[number, number]>([0, 0]);
  const [zoom, setZoom] = useState(1);

  const markerScale = 1 / Math.max(zoom, 1);

  // Source-type filter: when a type is picked, show only countries with that category,
  // and the marker count reflects that category (not the all-source total).
  const activeCat = selectedRegion ? REGION_CATEGORY[selectedRegion] : null;
  const visiblePoints = activeCat ? points.filter((p) => (p.byCategory?.[activeCat] ?? 0) > 0) : points;
  const countOf = (p: MapPoint) => (activeCat ? p.byCategory?.[activeCat] ?? 0 : p.count);
  const rowsOf = (p: MapPoint) =>
    activeCat ? [`${countOf(p)} ${selectedRegion.toLowerCase()}`] : p.rows ?? [`${p.count} sources`];
  const totalRecords = visiblePoints.reduce((s, p) => s + countOf(p), 0);

  function relPos(e: { clientX: number; clientY: number }) {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function show(e: ReactMouseEvent<SVGElement>, c: Pick<TooltipState, "title" | "rows">) {
    setTooltip({ ...c, ...relPos(e) });
  }
  function move(e: ReactMouseEvent<SVGElement>) {
    setTooltip((t) => (t ? { ...t, ...relPos(e) } : t));
  }
  function selectPoint(p: MapPoint) {
    setSelectedId(p.id);
    setCenter(p.coordinates);
    setZoom(3);
    setTooltip(null);
  }
  function reset() {
    setSelectedId(null);
    setCenter([0, 0]);
    setZoom(1);
    setTooltip(null);
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
        <MetricCard label="Zoom" value={`${Math.round(zoom * 10) / 10}x`} />
      </div>

      {/* Map panel */}
      <div className="src-map-wrap">
        <div ref={mapRef} className="src-map">
          <ComposableMap
            projection="geoEqualEarth"
            projectionConfig={{ scale: 190 }}
            className="src-svg"
          >
            <ZoomableGroup
              center={center}
              zoom={zoom}
              minZoom={1}
              maxZoom={5}
              onMoveEnd={({ coordinates, zoom: z }) => {
                setCenter(coordinates);
                setZoom(z);
              }}
            >
              {/* Land */}
              <Geographies geography={worldTopology}>
                {({ geographies }) =>
                  geographies.map((geo) => (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      style={{
                        default: { fill: COLOR.land, stroke: COLOR.landStroke, strokeWidth: 0.35, outline: "none" },
                        hover: { fill: COLOR.landHover, stroke: COLOR.landStroke, strokeWidth: 0.35, outline: "none" },
                        pressed: { fill: COLOR.landHover, stroke: COLOR.landStroke, strokeWidth: 0.35, outline: "none" },
                      }}
                    />
                  ))
                }
              </Geographies>

              {/* Links — translucent accent arcs */}
              {links.map((link) => (
                <Line
                  key={link.id}
                  from={link.from}
                  to={link.to}
                  stroke="#fb7185"
                  strokeWidth={1.2}
                  strokeLinecap="round"
                  strokeOpacity={0.42}
                  onMouseEnter={(e) => show(e, { title: link.title, rows: ["Connection"] })}
                  onMouseMove={move}
                  onMouseLeave={() => setTooltip(null)}
                />
              ))}

              {/* Markers */}
              {visiblePoints.map((p) => {
                const isSel = selectedId === p.id;
                const n = countOf(p);
                return (
                  <Marker
                    key={p.id}
                    coordinates={p.coordinates}
                    onMouseEnter={(e) => show(e, { title: p.name, rows: rowsOf(p) })}
                    onMouseMove={move}
                    onMouseLeave={() => setTooltip(null)}
                    onClick={() => selectPoint(p)}
                  >
                    <circle
                      r={(isSel ? 10 : 8) * markerScale}
                      fill={isSel ? COLOR.markerSel : COLOR.marker}
                      stroke={COLOR.accentStrokeSel}
                      strokeWidth={1.2 * markerScale}
                      className="src-marker"
                    />
                    <text
                      y={3.5 * markerScale}
                      textAnchor="middle"
                      className="src-marker-label"
                      style={{ fontSize: `${9 * markerScale}px` }}
                    >
                      {n}
                    </text>
                  </Marker>
                );
              })}
            </ZoomableGroup>
          </ComposableMap>

          {/* Floating overlay panels */}
          <div className="src-overlay">
            <SourceTypePanel
              regions={regions}
              selected={selectedRegion}
              onSelect={(r) => {
                setSelectedRegion((cur) => (cur === r ? "" : r));
                reset();
              }}
              onClear={() => {
                setSelectedRegion("");
                reset();
              }}
            />
            {selectedId ? (
              <button type="button" onClick={reset} className="src-reset">
                Reset view
              </button>
            ) : null}
          </div>

          <Tooltip tooltip={tooltip} />
        </div>
        <p className="src-note">Origin inferred from source domain, sanctions issuer, and registry jurisdiction.</p>
      </div>
    </section>
  );
}
