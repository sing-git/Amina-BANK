// Stage 2 — Claude Haiku 4.5, RAG-grounded single-signal classification.
// Runs keyless via a deterministic stub (see llm.ts).
import type { ClientBaseline, RawSignal, SignalScore } from "../types.js";
import { callLLM, extractJSON } from "./llm.js";
import { buildStage2User, STAGE2_SYSTEM } from "../prompts/stage2.js";
import { isFraudTypology, recommendedAction } from "./recommendations.js";
import type { Evidence } from "./mcpNews.js";

const MODEL = "claude-haiku-4-5-20251001";

interface Stage2JSON {
  direction: "risk_increasing" | "neutral_update" | "positive";
  magnitude: number;
  rationale: string;
  suggested_action?: string;
  source_citations: string[];
  confidence: number;
}

export async function classifySignal(
  baseline: ClientBaseline,
  signal: RawSignal,
  embeddingScores: {
    baselineSimilarity?: number;
    archetypeMatches?: Array<{ archetype: string; similarity: number }>;
  },
  retrievedEvidence: Evidence[],
): Promise<SignalScore> {
  const user = buildStage2User(baseline, signal, embeddingScores, retrievedEvidence);

  const { text } = await callLLM({
    stage: 2,
    model: MODEL,
    system: STAGE2_SYSTEM,
    user,
    maxTokens: 400,
    signalId: signal.signalId,
    stub: () => stubClassify(signal, embeddingScores, retrievedEvidence),
  });

  const parsed = extractJSON<Stage2JSON>(text);
  return {
    signalId: signal.signalId,
    category: signal.category,
    method: "llm_classification",
    magnitude: Math.max(0, Math.min(100, Math.round(parsed.magnitude))),
    direction: parsed.direction,
    rationale: parsed.rationale,
    suggestedAction: parsed.suggested_action?.trim() || recommendedAction(signal.category),
    sourceCitations: parsed.source_citations?.length
      ? parsed.source_citations
      : retrievedEvidence.map((e) => e.sourceUrl),
    confidence: Math.max(0, Math.min(1, parsed.confidence)),
    isFraudTypology: isFraudTypology(signal.category),
  };
}

// Deterministic, defensible stub used when no ANTHROPIC_API_KEY is present.
// Drives direction off the embedding gate so demos still tell a coherent story.
function stubClassify(
  signal: RawSignal,
  embeddingScores: { baselineSimilarity?: number; archetypeMatches?: Array<{ archetype: string; similarity: number }> },
  evidence: Evidence[],
): string {
  const top = embeddingScores.archetypeMatches?.[0];
  const baselineSim = embeddingScores.baselineSimilarity ?? 1;
  const archSim = top?.similarity ?? 0;
  const riskish = baselineSim < 0.6 || archSim > 0.55;
  const direction = riskish ? "risk_increasing" : "neutral_update";
  const magnitude = riskish ? Math.round(Math.min(100, 40 + archSim * 60)) : 25;
  const confidence = riskish ? 0.62 : 0.45;
  const rationale = riskish
    ? `[STUB — no LLM key] Current activity diverges from the onboarding profile (baseline similarity ${baselineSim.toFixed(2)}) and resembles the "${top?.archetype ?? "unknown"}" risk pattern. Recommend analyst review.`
    : `[STUB — no LLM key] Signal is broadly consistent with the declared profile; flag as a routine update for threshold refresh.`;
  return JSON.stringify({
    direction,
    magnitude,
    rationale,
    source_citations: evidence.map((e) => e.sourceUrl),
    confidence,
  });
}
