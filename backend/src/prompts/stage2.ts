import type { ClientBaseline, RawSignal } from "../types.js";

export const STAGE2_SYSTEM =
  "You are classifying a single risk signal for a private bank's compliance team. " +
  "Use ONLY the facts given. Do not invent figures or facts not present. " +
  "If the evidence does not clearly support a conclusion, set direction to " +
  '"neutral_update" and confidence below 0.5 rather than guessing.';

export function buildStage2User(
  baseline: ClientBaseline,
  signal: RawSignal,
  embeddingScores: {
    baselineSimilarity?: number;
    archetypeMatches?: Array<{ archetype: string; similarity: number }>;
  },
  retrievedEvidence: Array<{ sourceUrl: string; text: string }>,
): string {
  const top = embeddingScores.archetypeMatches?.[0];
  const evidence = retrievedEvidence.map((e) => `- [${e.sourceUrl}]: ${e.text}`).join("\n") || "- (none)";
  return `CLIENT BASELINE (synthetic, established at onboarding)
Declared business: ${baseline.declaredBusinessDescription}
Risk rating: ${baseline.riskRating}
Expected monthly volume: ${baseline.expectedMonthlyVolumeUSD} USD

SIGNAL
Category: ${signal.category}
Detected: ${signal.detectedAt}
Raw content: ${signal.rawText ?? "(none)"}

EMBEDDING SCORES (for reference only — you make the final call)
Baseline similarity: ${embeddingScores.baselineSimilarity?.toFixed(3) ?? "n/a"}
Closest risk archetype: ${top ? `${top.archetype} (${top.similarity.toFixed(3)})` : "n/a"}

RETRIEVED EVIDENCE
${evidence}

Return ONLY this JSON shape, no markdown fences, no commentary:
{
  "direction": "risk_increasing" | "neutral_update" | "positive",
  "magnitude": <0-100 integer>,
  "rationale": "<one or two plain-language sentences a compliance officer can read directly>",
  "suggested_action": "<one concrete next step, e.g. 'Trigger KYC refresh; re-screen UBOs against sanctions/PEP'>",
  "source_citations": ["<url or source id from retrievedEvidence only>"],
  "confidence": <0-1 float>
}`;
}
