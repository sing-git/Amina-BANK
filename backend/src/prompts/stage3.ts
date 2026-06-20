import type { ClientBaseline, CompositeScoreResult } from "../types.js";

export const STAGE3_SYSTEM =
  "You are preparing a full compliance escalation report for a human reviewer. " +
  "This client has been flagged HIGH RISK by an automated scoring engine. " +
  "Use only the evidence provided. Cite the specific source for every factual claim. " +
  "This output is advisory only — a human must approve any action before it is taken.";

export function buildStage3User(
  baseline: ClientBaseline,
  compositeResult: CompositeScoreResult,
  allEvidence: Array<{ sourceUrl: string; text: string }>,
  timeSeriesSummary: string,
): string {
  const signals = compositeResult.contributingSignals
    .map((s) => `- ${s.category} | ${s.direction} | magnitude ${s.magnitude} | ${s.rationale}`)
    .join("\n");
  const evidence = allEvidence.map((e) => `- [${e.sourceUrl}]: ${e.text}`).join("\n") || "- (none)";

  return `CLIENT BASELINE
${JSON.stringify(baseline, null, 2)}

COMPOSITE SCORE RESULT
Score: ${compositeResult.compositeScore}/100  (flag: ${compositeResult.riskFlag})
Contributing signals:
${signals}

TRANSACTION TIME-SERIES (reason over this together with the news below)
${timeSeriesSummary}

ALL EVIDENCE COLLECTED
${evidence}

Produce ONLY this JSON:
{
  "summary": "<3-4 sentence executive summary; state explicitly that a human must approve any action>",
  "full_reasoning_chain": "<step by step reasoning connecting each signal to the conclusion>",
  "all_sources_used": ["<source URLs actually cited above>"],
  "recommended_action": "<one of: file SAR, request enhanced KYC documents, escalate to senior compliance, no action needed>"
}`;
}
