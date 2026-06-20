// Numeric signals — pure arithmetic, NO LLM. See spec section 3.1 and 9 (formulas).
//
// Each function implements one AML/fraud TYPOLOGY with an explicit, documented formula.
// Determinism is the point: a compliance officer (and an auditor) can reproduce every flag
// by hand. No model is involved here.
import type { ClientBaseline, RawSignal, SignalCategory, SignalScore, TransactionRecord } from "../types.js";
import { isFraudTypology, recommendedAction } from "./recommendations.js";
import { POLICY } from "./policy.js";

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

// ── Tunable thresholds — all from the compliance-owned policy (config/riskPolicy.json) ──
const {
  windowDays: WINDOW_DAYS,
  ctrThresholdUSD: CTR_THRESHOLD_USD,
  structuringBandLo: STRUCTURING_BAND_LO,
  structuringMinCount: STRUCTURING_MIN_COUNT,
  volumeSurgeRatio: VOLUME_SURGE_RATIO,
  passthroughRatio: PASSTHROUGH_RATIO,
  dormancyDays: DORMANCY_DAYS,
} = POLICY.transactionRules;

function recentWindow(txs: TransactionRecord[], days: number): TransactionRecord[] {
  if (txs.length === 0) return [];
  const latest = Math.max(...txs.map((t) => Date.parse(t.date)));
  const cutoff = latest - days * 86_400_000;
  return txs.filter((t) => Date.parse(t.date) >= cutoff);
}

function score(
  baseline: ClientBaseline,
  category: SignalCategory,
  magnitude: number,
  rationale: string,
  confidence: number,
): SignalScore {
  return {
    signalId: `${category}-${baseline.clientId}`,
    category,
    method: "rule_diff",
    magnitude: Math.round(clamp(magnitude)),
    direction: "risk_increasing",
    rationale,
    suggestedAction: recommendedAction(category),
    sourceCitations: [`internal:tx-monitor:${baseline.clientId}`],
    confidence,
    isFraudTypology: isFraudTypology(category),
  };
}

/**
 * STRUCTURING (smurfing) — many transfers just under the reporting threshold.
 * Formula:
 *   band   = { tx : 0.8×T ≤ amount < T }        within WINDOW_DAYS
 *   flag if |band| ≥ STRUCTURING_MIN_COUNT
 *   magnitude = clamp(|band| × 20)               (3 → 60, 5 → 100)
 */
export function checkStructuring(baseline: ClientBaseline, txs: TransactionRecord[]): SignalScore | null {
  const window = recentWindow(txs, WINDOW_DAYS);
  const band = window.filter(
    (t) => t.amountUSD >= CTR_THRESHOLD_USD * STRUCTURING_BAND_LO && t.amountUSD < CTR_THRESHOLD_USD,
  );
  if (band.length < STRUCTURING_MIN_COUNT) return null;
  return score(
    baseline,
    "structuring_pattern",
    band.length * 20,
    `${band.length} transfers between $${(CTR_THRESHOLD_USD * STRUCTURING_BAND_LO).toLocaleString()} and ` +
      `$${(CTR_THRESHOLD_USD - 1).toLocaleString()} (just below the $${CTR_THRESHOLD_USD.toLocaleString()} ` +
      `reporting threshold) within ${WINDOW_DAYS} days — consistent with structuring to avoid reporting.`,
    0.85,
  );
}

/**
 * CROSS-BORDER ANOMALY / MONEY MULE — volume surge + funds passing straight through
 * to unexpected jurisdictions.
 * Formula (over WINDOW_DAYS):
 *   inVol, outVol         = Σ inbound, Σ outbound amounts
 *   deviation             = (inVol + outVol − expectedMonthlyVolume) / expectedMonthlyVolume
 *   passThrough           = inVol>0 ? outVol / inVol : 1
 *   crossOut              = outbound txs to regions ∉ expectedCounterpartyRegions
 *   crossShare            = Σ crossOut amount / max(outVol, 1)
 *   flag if crossOut ≠ ∅ AND (deviation > VOLUME_SURGE_RATIO OR passThrough ≥ PASSTHROUGH_RATIO)
 *   magnitude = clamp( min(deviation,2)×30 + crossShare×40 + (passThrough≥0.8 ? 30 : 0) )
 */
export function checkCrossBorderMule(baseline: ClientBaseline, txs: TransactionRecord[]): SignalScore | null {
  const window = recentWindow(txs, WINDOW_DAYS);
  if (window.length === 0) return null;

  const inVol = window.filter((t) => t.direction === "inbound").reduce((s, t) => s + t.amountUSD, 0);
  const outVol = window.filter((t) => t.direction === "outbound").reduce((s, t) => s + t.amountUSD, 0);
  const expected = baseline.expectedMonthlyVolumeUSD || 1;
  const deviation = (inVol + outVol - expected) / expected;
  const passThrough = inVol > 0 ? outVol / inVol : 1;

  const crossOut = window.filter(
    (t) => t.direction === "outbound" && !baseline.expectedCounterpartyRegions.includes(t.counterpartyRegion),
  );
  if (crossOut.length === 0) return null;
  if (deviation <= VOLUME_SURGE_RATIO && passThrough < PASSTHROUGH_RATIO) return null;

  const crossVol = crossOut.reduce((s, t) => s + t.amountUSD, 0);
  const crossShare = crossVol / Math.max(outVol, 1);
  const magnitude = Math.min(deviation, 2) * 30 + crossShare * 40 + (passThrough >= 0.8 ? 30 : 0);
  const regions = [...new Set(crossOut.map((t) => t.counterpartyRegion))].join(", ");

  return score(
    baseline,
    "cross_border_anomaly",
    magnitude,
    `Last-${WINDOW_DAYS}-day flow of $${Math.round(inVol + outVol).toLocaleString()} is ` +
      `${Math.round(deviation * 100)}% vs the expected $${expected.toLocaleString()}; ` +
      `${Math.round(passThrough * 100)}% of inbound funds passed straight out to ${crossOut.length} ` +
      `transfer(s) into unexpected region(s): ${regions} — potential money-mule / layering.`,
    0.9,
  );
}

/**
 * DORMANCY BREAK — long inactivity then a sudden surge.
 * Formula:
 *   maxGap = largest gap (days) between consecutive transactions
 *   burst  = Σ amounts in the 30 days AFTER that gap
 *   flag if maxGap ≥ DORMANCY_DAYS AND burst > 0
 *   magnitude = clamp(40 + maxGap / 10)
 */
export function checkDormancyBreak(
  baseline: ClientBaseline,
  txs: TransactionRecord[],
  dormancyWindowDays = DORMANCY_DAYS,
): SignalScore | null {
  if (txs.length < 2) return null;
  const sorted = [...txs].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  let maxGapDays = 0;
  let gapEndIdx = -1;
  for (let i = 1; i < sorted.length; i++) {
    const gap = (Date.parse(sorted[i]!.date) - Date.parse(sorted[i - 1]!.date)) / 86_400_000;
    if (gap > maxGapDays) {
      maxGapDays = gap;
      gapEndIdx = i;
    }
  }
  if (maxGapDays < dormancyWindowDays || gapEndIdx === -1) return null;

  const afterGap = recentWindow(sorted.slice(gapEndIdx), WINDOW_DAYS);
  const burst = afterGap.reduce((s, t) => s + t.amountUSD, 0);
  if (burst === 0) return null;

  return score(
    baseline,
    "dormancy_break",
    40 + maxGapDays / 10,
    `Account dormant for ~${Math.round(maxGapDays)} days, then reactivated with ` +
      `$${Math.round(burst).toLocaleString()} of activity in the following ${WINDOW_DAYS} days.`,
    0.85,
  );
}

/** Run every transaction typology check; return all that fire (they are distinct patterns). */
export function runTransactionChecks(baseline: ClientBaseline, txs: TransactionRecord[]): SignalScore[] {
  return [
    checkStructuring(baseline, txs),
    checkCrossBorderMule(baseline, txs),
    checkDormancyBreak(baseline, txs),
  ].filter((s): s is SignalScore => s !== null);
}

/**
 * FUNDING SCALE — public funding event changes the activity baseline.
 * Formula: multiple = current / previous; magnitude = clamp(log10(multiple) × 50).
 * Default direction is neutral_update (Stage 2 may re-judge with narrative context).
 */
export function checkFundingScale(raw: RawSignal): SignalScore | null {
  const prev = raw.rawNumericContext?.previousFundingUSD ?? 0;
  const curr = raw.rawNumericContext?.currentFundingUSD ?? raw.rawNumeric ?? 0;
  if (curr <= 0) return null;
  const multiple = prev > 0 ? curr / prev : curr / 1_000_000;

  return {
    signalId: raw.signalId,
    category: "funding_scale_change",
    method: "rule_diff",
    magnitude: Math.round(clamp(Math.log10(Math.max(multiple, 1.01)) * 50)),
    direction: "neutral_update",
    rationale:
      `Funding changed from $${prev.toLocaleString()} to $${curr.toLocaleString()}` +
      ` (~${multiple.toFixed(1)}x). Reassess transaction-monitoring thresholds.`,
    suggestedAction: recommendedAction("funding_scale_change"),
    sourceCitations: raw.sourceUrl ? [raw.sourceUrl] : [`funding_db:${raw.signalId}`],
    confidence: 0.8,
    isFraudTypology: false,
  };
}
