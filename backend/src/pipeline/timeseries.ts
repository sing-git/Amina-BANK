// "TSLM-lite": compress a transaction time-series into a compact text summary so a normal
// LLM (Stage 3) can reason over numbers + news together — the cheap approximation of a
// Time-Series Language Model (cf. ETH OpenTSLM). No extra model, no GPU.
import type { ClientBaseline, TransactionRecord } from "../types.js";

export function summarizeTransactions(baseline: ClientBaseline, txs: TransactionRecord[]): string {
  if (txs.length === 0) return "No transaction history available.";

  // monthly buckets (YYYY-MM)
  const byMonth = new Map<string, { in: number; out: number; count: number; regions: Set<string> }>();
  for (const t of txs) {
    const m = t.date.slice(0, 7);
    const b = byMonth.get(m) ?? { in: 0, out: 0, count: 0, regions: new Set<string>() };
    if (t.direction === "inbound") b.in += t.amountUSD;
    else b.out += t.amountUSD;
    b.count += 1;
    b.regions.add(t.counterpartyRegion);
    byMonth.set(m, b);
  }
  const k = (n: number) => `$${Math.round(n / 1000)}k`;
  const series = [...byMonth.keys()]
    .sort()
    .map((m) => {
      const b = byMonth.get(m)!;
      return `  ${m}: in ${k(b.in)}, out ${k(b.out)}, ${b.count} tx → ${[...b.regions].join("/")}`;
    })
    .join("\n");

  // longest dormancy gap
  const sorted = [...txs].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  let maxGap = 0;
  for (let i = 1; i < sorted.length; i++) {
    const g = (Date.parse(sorted[i]!.date) - Date.parse(sorted[i - 1]!.date)) / 86_400_000;
    if (g > maxGap) maxGap = g;
  }

  // unexpected regions
  const unexpected = [
    ...new Set(
      txs
        .filter((t) => t.direction === "outbound" && !baseline.expectedCounterpartyRegions.includes(t.counterpartyRegion))
        .map((t) => t.counterpartyRegion),
    ),
  ];

  return [
    `Expected: ${k(baseline.expectedMonthlyVolumeUSD)}/month, regions ${baseline.expectedCounterpartyRegions.join("/") || "n/a"}.`,
    `Observed monthly series:`,
    series,
    `Longest dormancy gap: ${Math.round(maxGap)} days.`,
    unexpected.length ? `Outbound to UNEXPECTED regions: ${unexpected.join(", ")}.` : `No unexpected outbound regions.`,
  ].join("\n");
}
