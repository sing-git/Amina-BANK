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

  const riskSum = riskSignals.reduce(
    (acc, s) => acc + (s.magnitude * ((SIGNAL_WEIGHTS[s.category] ?? 0) / MAX_WEIGHT) * s.confidence),
    0,
  );
  const softening = positiveSignals.reduce(
    (acc, s) =>
      acc + s.magnitude * ((SIGNAL_WEIGHTS[s.category] ?? 0) / MAX_WEIGHT) * s.confidence * POLICY.softeningFactor,
    0,
  );

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
