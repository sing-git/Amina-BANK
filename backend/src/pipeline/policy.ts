// Loads the compliance-owned risk policy (config/riskPolicy.json) — the SINGLE place
// every tunable lives. Onboarding a different institution = swap this file, no code change.
// This is the "scalable via parameters" + "exact logic" requirement made concrete.
import { createRequire } from "node:module";
import type { SignalCategory } from "../types.js";

const require = createRequire(import.meta.url);

export interface RiskPolicy {
  policyId: string;
  version: string;
  approvedBy: string;
  flagBands: { mediumFrom: number; highFrom: number };
  softeningFactor: number;
  aggregation: { duplicateDiscount: number; neutralFactor: number };
  signalWeights: Record<SignalCategory, number>;
  transactionRules: {
    windowDays: number;
    ctrThresholdUSD: number;
    structuringBandLo: number;
    structuringMinCount: number;
    volumeSurgeRatio: number;
    passthroughRatio: number;
    dormancyDays: number;
  };
  embeddingGate: { baselineSimMax: number; archetypeSimMin: number };
  signalFilter: { minConfidence: number; minMagnitude: number };
  sanctions: { autoThreshold: number; reviewThreshold: number };
  jury: { enabled: boolean };
  riskArchetypes: Record<string, string>;
}

// strip "_doc" annotation keys from any map we iterate over
function stripDocs<T>(obj: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith("_")));
}

const rawPolicy = require("../config/riskPolicy.json") as RiskPolicy;
export const POLICY: RiskPolicy = {
  ...rawPolicy,
  signalWeights: stripDocs(rawPolicy.signalWeights) as RiskPolicy["signalWeights"],
  riskArchetypes: stripDocs(rawPolicy.riskArchetypes),
};

// derived once
export const MAX_WEIGHT = Math.max(...Object.values(POLICY.signalWeights));

/** riskFlag from a 0–100 composite score, per the policy's bands. */
export function flagForScore(score: number): "low" | "medium" | "high" {
  if (score < POLICY.flagBands.mediumFrom) return "low";
  if (score < POLICY.flagBands.highFrom) return "medium";
  return "high";
}
