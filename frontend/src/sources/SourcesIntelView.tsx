import { useEffect, useMemo, useState } from "react";
import { fetchDriftSignals, fetchSanctionsFlags, fetchRegistryDrift } from "../api";
import type { RawCompany, SanctionFlag, RegistryDriftEntry } from "../clusters/graph";
import { buildSourceMap } from "./sourceGeo";
import type { MapPoint } from "./WorldMap";
import "./sources-intel.css";

const FLAG: Record<string, string> = {
  US: "🇺🇸", GB: "🇬🇧", DE: "🇩🇪", CH: "🇨🇭", SG: "🇸🇬",
  IE: "🇮🇪", AU: "🇦🇺", ES: "🇪🇸", FR: "🇫🇷", CA: "🇨🇦",
  NZ: "🇳🇿", IN: "🇮🇳", HK: "🇭🇰", AE: "🇦🇪", ZA: "🇿🇦",
};

type SortKey = "count" | "name";
type Cat = "news" | "sanctions" | "registry";

const COLS: { key: Cat; label: string; icon: string; color: string; bgVar: string }[] = [
  { key: "news",       label: "News Feeds",           icon: "📰", color: "#3b82f6", bgVar: "hsl(217 91% 97%)" },
  { key: "sanctions",  label: "Sanctions Lists",       icon: "⚖️",  color: "#ef4444", bgVar: "hsl(0 86% 97%)"   },
  { key: "registry",  label: "Corporate Registries",  icon: "🏢", color: "#14b8a6", bgVar: "hsl(173 80% 96%)" },
];

function CountryCard({
  point,
  cat,
  max,
  active,
  onClick,
}: {
  point: MapPoint;
  cat: Cat;
  max: number;
  active: boolean;
  onClick: () => void;
}) {
  const count = point.byCategory?.[cat] ?? 0;
  const pct = max > 0 ? (count / max) * 100 : 0;
  const colDef = COLS.find((c) => c.key === cat)!;

  return (
    <button
      className={`si-card ${active ? "si-card-active" : ""}`}
      onClick={onClick}
      style={{ "--si-bar-color": colDef.color } as React.CSSProperties}
    >
      <div className="si-card-top">
        <span className="si-flag">{FLAG[point.id] ?? "🌐"}</span>
        <span className="si-name">{point.name}</span>
        <span className="si-count">{count}</span>
      </div>
      <div className="si-bar-track">
        <div className="si-bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </button>
  );
}

function ColHeader({
  label,
  icon,
  color,
  total,
  countries,
}: {
  label: string;
  icon: string;
  color: string;
  total: number;
  countries: number;
}) {
  return (
    <div className="si-col-header" style={{ "--si-col-color": color } as React.CSSProperties}>
      <div className="si-col-title">
        <span className="si-col-icon">{icon}</span>
        <span className="si-col-label">{label}</span>
      </div>
      <div className="si-col-meta">
        <span className="si-col-num">{total}</span>
        <span className="si-col-unit">signals</span>
        <span className="si-col-sep">·</span>
        <span className="si-col-ctry">{countries} countries</span>
      </div>
    </div>
  );
}

export function SourcesIntelView() {
  const [companies, setCompanies] = useState<RawCompany[]>([]);
  const [flags, setFlags] = useState<SanctionFlag[]>([]);
  const [registry, setRegistry] = useState<RegistryDriftEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("count");
  const [selected, setSelected] = useState<MapPoint | null>(null);

  useEffect(() => {
    Promise.all([fetchDriftSignals(), fetchSanctionsFlags(), fetchRegistryDrift()]).then(
      ([c, f, r]) => { setCompanies(c); setFlags(f); setRegistry(r); setReady(true); },
    );
  }, []);

  const { points, regions } = useMemo(
    () => buildSourceMap(companies, flags, registry),
    [companies, flags, registry],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pts = q ? points.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)) : points;
    if (sortBy === "name") return [...pts].sort((a, b) => a.name.localeCompare(b.name));
    return [...pts].sort((a, b) => b.count - a.count);
  }, [points, query, sortBy]);

  const totals = useMemo(() => {
    const t = { news: 0, sanctions: 0, registry: 0 };
    for (const p of points) {
      t.news += p.byCategory?.news ?? 0;
      t.sanctions += p.byCategory?.sanctions ?? 0;
      t.registry += p.byCategory?.registry ?? 0;
    }
    return t;
  }, [points]);

  const maxPerCat = useMemo(() => {
    const m = { news: 0, sanctions: 0, registry: 0 };
    for (const p of filtered) {
      m.news = Math.max(m.news, p.byCategory?.news ?? 0);
      m.sanctions = Math.max(m.sanctions, p.byCategory?.sanctions ?? 0);
      m.registry = Math.max(m.registry, p.byCategory?.registry ?? 0);
    }
    return m;
  }, [filtered]);

  if (!ready) return <div className="empty">Loading sources…</div>;

  return (
    <div className="si-root">
      {/* Header */}
      <div className="si-head">
        <div>
          <p className="si-eyebrow">Intelligence feeds</p>
          <h1 className="si-title">Sources</h1>
        </div>

        {/* Summary chips */}
        <div className="si-summary">
          <div className="si-chip si-chip-total">
            <span className="si-chip-num">{points.length}</span>
            <span className="si-chip-label">Countries</span>
          </div>
          {regions.map((r) => (
            <div key={r.label} className={`si-chip si-chip-${r.label === "News feeds" ? "news" : r.label === "Sanctions lists" ? "sanctions" : "registry"}`}>
              <span className="si-chip-num">{r.count}</span>
              <span className="si-chip-label">{r.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className="si-toolbar">
        <input
          className="si-search"
          placeholder="Filter by country…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="si-sort">
          <span className="si-sort-label">Sort by</span>
          <button
            className={`si-sort-btn ${sortBy === "count" ? "si-sort-on" : ""}`}
            onClick={() => setSortBy("count")}
          >
            Count
          </button>
          <button
            className={`si-sort-btn ${sortBy === "name" ? "si-sort-on" : ""}`}
            onClick={() => setSortBy("name")}
          >
            Name
          </button>
        </div>
      </div>

      {/* 3-column swimlane */}
      <div className="si-swimlanes">
        {COLS.map((col) => {
          const colPoints = filtered.filter((p) => (p.byCategory?.[col.key] ?? 0) > 0);
          const colTotal = colPoints.reduce((s, p) => s + (p.byCategory?.[col.key] ?? 0), 0);

          return (
            <div key={col.key} className="si-lane">
              <ColHeader
                label={col.label}
                icon={col.icon}
                color={col.color}
                total={colTotal}
                countries={colPoints.length}
              />
              <div className="si-lane-cards">
                {colPoints.length === 0 && (
                  <p className="si-empty">No matching countries.</p>
                )}
                {colPoints.map((p) => (
                  <CountryCard
                    key={p.id}
                    point={p}
                    cat={col.key}
                    max={maxPerCat[col.key]}
                    active={selected?.id === p.id}
                    onClick={() => setSelected(selected?.id === p.id ? null : p)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail drawer — slides up when a country is selected */}
      {selected && (
        <div className="si-detail-backdrop" onClick={() => setSelected(null)}>
          <div className="si-detail" onClick={(e) => e.stopPropagation()}>
            <div className="si-detail-head">
              <div className="si-detail-flag">{FLAG[selected.id] ?? "🌐"}</div>
              <div>
                <h2 className="si-detail-name">{selected.name}</h2>
                <p className="si-detail-id">{selected.id} · {selected.count} total signals</p>
              </div>
              <button className="si-detail-close" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="si-detail-body">
              {COLS.map((col) => {
                const count = selected.byCategory?.[col.key] ?? 0;
                const pct = totals[col.key] > 0 ? ((count / totals[col.key]) * 100).toFixed(1) : "0";
                return (
                  <div key={col.key} className="si-detail-row">
                    <div className="si-detail-row-head">
                      <span className="si-detail-icon">{col.icon}</span>
                      <span className="si-detail-row-label">{col.label}</span>
                    </div>
                    <div className="si-detail-bar-wrap" style={{ "--si-bar-color": col.color } as React.CSSProperties}>
                      <div className="si-detail-bar" style={{ width: count > 0 ? `${(count / Math.max(selected.byCategory?.news ?? 0, selected.byCategory?.sanctions ?? 0, selected.byCategory?.registry ?? 0)) * 100}%` : "0%" }} />
                    </div>
                    <div className="si-detail-nums">
                      <span className="si-detail-count" style={{ color: col.color }}>{count}</span>
                      <span className="si-detail-pct">{pct}% of global {col.key}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
