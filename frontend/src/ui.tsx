// Small reusable presentational components.
import type { Alert, RiskFlag } from "./types";

export function humanize(category: string): string {
  const s = category.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const FLAG_ORDER: RiskFlag[] = ["critical", "high", "medium", "low"];

// Portfolio rollup: counts by risk flag + an honest data-source / live badge.
export function QueueSummary({
  alerts,
  live,
  source,
}: {
  alerts: Alert[];
  live: boolean;
  source?: string;
}) {
  const counts = alerts.reduce<Record<string, number>>((acc, a) => {
    acc[a.composite.riskFlag] = (acc[a.composite.riskFlag] ?? 0) + 1;
    return acc;
  }, {});
  const sourceLabel = !live
    ? "Offline · bundled demo data"
    : source === "cached"
      ? "Gemini · cached"
      : source === "postgres"
        ? "Live · Postgres"
        : source === "json-files"
          ? "Live · JSON files"
          : "Live · demo";
  return (
    <div className="queue-summary">
      <span className="summary-total">{alerts.length} clients</span>
      <div className="summary-counts">
        {FLAG_ORDER.filter((f) => counts[f]).map((f) => (
          <span key={f} className={`summary-count summary-count-${f}`}>
            {counts[f]} {f.toUpperCase()}
          </span>
        ))}
      </div>
      <span className={`mode ${live ? "mode-live" : "mode-offline"}`}>{sourceLabel}</span>
    </div>
  );
}

// Which cost tier produced a signal — ties the per-signal view to the cost story.
export function MethodTag({ method }: { method: string }) {
  const label =
    method === "rule_diff"
      ? "Rule diff · free"
      : method === "embedding"
        ? "Embedding · free"
        : method === "llm_classification"
          ? "LLM · Stage 2/3"
          : method;
  return <span className={`method-tag method-${method}`}>{label}</span>;
}

export function RiskPill({ flag }: { flag: RiskFlag }) {
  return <span className={`pill pill-${flag}`}>{flag.toUpperCase()}</span>;
}

export function SyntheticChip() {
  return <span className="chip chip-synth">SYNTHETIC</span>;
}

export function ScoreMeter({ score }: { score: number }) {
  const band: RiskFlag = score >= 80 ? "critical" : score > 60 ? "high" : score >= 30 ? "medium" : "low";
  return (
    <div className="meter" title={`${score}/100`}>
      <div className={`meter-fill meter-${band}`} style={{ width: `${Math.min(100, score)}%` }} />
      <span className="meter-label">{score}</span>
    </div>
  );
}

export function Bar({ value, max, kind }: { value: number; max: number; kind: "mag" | "conf" }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="bar">
      <div className={`bar-fill bar-${kind}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function DirectionTag({ direction }: { direction: string }) {
  const cls =
    direction === "risk_increasing" ? "risk" : direction === "positive" ? "pos" : "neutral";
  return <span className={`dir dir-${cls}`}>{humanize(direction)}</span>;
}

export function driftArrow(from: string, to: RiskFlag): string {
  const rank: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  const worse = (rank[to] ?? 0) > (rank[from] ?? 0);
  return `${from} → ${to.toUpperCase()}${worse ? " ⚠" : ""}`;
}
