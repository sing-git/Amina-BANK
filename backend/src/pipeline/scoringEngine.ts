// Weighted aggregation. Confidence-adjusted: magnitude × weight × confidence.
// See spec sections 3.5 and 6.5. Weights are loaded from a compliance-owned
// JSON config (the AI executes policy, it does not set policy).

import type { CompositeScoreResult, SignalScore } from "../types.js";
import type { HardGateResult } from "./hardGate.js";
import { flagForScore, MAX_WEIGHT, POLICY } from "./policy.js";

// All tunables come from the compliance-owned policy (config/riskPolicy.json).
// Weights are RELATIVE importance; we scale each signal's severity by weight/maxWeight,
// so a single high-importance, high-magnitude, high-confidence signal can push a client
// into HIGH — matching README's reference table.
export const SIGNAL_WEIGHTS = POLICY.signalWeights;
export const WEIGHTS_VERSION = POLICY.version;

// Sum contributions with diminishing returns inside each category:
//   categoryTotal = max(contribs) + duplicateDiscount × Σ(the rest)
// so a strong signal counts fully, while repeats of the same drift dimension add only
// a discounted tail. The overall score is the sum of per-category totals.
function aggregateByCategory(
  signals: SignalScore[],
  contribution: (s: SignalScore) => number,
  duplicateDiscount: number,
): number {
  const byCategory = new Map<string, number[]>();
  for (const s of signals) {
    const arr = byCategory.get(s.category) ?? [];
    arr.push(contribution(s));
    byCategory.set(s.category, arr);
  }
  let total = 0;
  for (const contribs of byCategory.values()) {
    contribs.sort((a, b) => b - a);
    const [top = 0, ...rest] = contribs;
    total += top + duplicateDiscount * rest.reduce((acc, c) => acc + c, 0);
  }
  return total;
}

export function computeCompositeScore(
  scores: SignalScore[],
  hardGateResult: HardGateResult,
): CompositeScoreResult {
  const clientId = scores[0]?.signalId ? scores[0]!.signalId.split("-").slice(-1)[0]! : "unknown";

  if (hardGateResult.matched) {
    return {
      clientId,
      compositeScore: 100,
      riskFlag: "critical",
      contributingSignals: scores,
      neutralSignals: [],
      hardGateTriggered: true,
      hardGateReason: `Sanctions/PEP exact match: ${hardGateResult.matchedEntity ?? "unknown"}`,
    };
  }

  const riskSignals = scores.filter((s) => s.direction === "risk_increasing");
  const positiveSignals = scores.filter((s) => s.direction === "positive");
  const neutralSignals = scores.filter((s) => s.direction === "neutral_update");

  // Per-signal contribution: magnitude × (relative weight) × confidence.
  const contribution = (s: SignalScore) =>
    s.magnitude * ((SIGNAL_WEIGHTS[s.category] ?? 0) / MAX_WEIGHT) * s.confidence;

  // Diminishing returns WITHIN a category: ten articles about the same pivot must not
  // score ten times a single one. A client's "negative_news" risk is driven by the
  // strongest item; repeats add only a discounted tail. This de-correlates the score
  // from raw news volume (big public companies have more articles, not more risk).
  // duplicateDiscount is compliance-owned policy (riskPolicy.aggregation).
  const riskSum = aggregateByCategory(riskSignals, contribution, POLICY.aggregation.duplicateDiscount);
  const softening =
    aggregateByCategory(positiveSignals, contribution, POLICY.aggregation.duplicateDiscount) *
    POLICY.softeningFactor;

  const compositeScore = Math.max(0, Math.min(100, riskSum - softening));

  return {
    clientId,
    compositeScore: Math.round(compositeScore),
    riskFlag: flagForScore(compositeScore),
    contributingSignals: riskSignals,
    neutralSignals, // these trigger the threshold-refresh workflow, not the score
    hardGateTriggered: false,
  };
}
