// Stage 3 — Claude Sonnet 4.6, escalated cases only. Keyless stub fallback.
import type { ClientBaseline, CompositeScoreResult, DeepAnalysisReport, TransactionRecord } from "../types.js";
import { callLLM, extractJSON } from "./llm.js";
import { buildStage3User, STAGE3_SYSTEM } from "../prompts/stage3.js";
import { summarizeTransactions } from "./timeseries.js";
import type { Evidence } from "./mcpNews.js";

const MODEL = "claude-sonnet-4-6";

interface Stage3JSON {
  summary: string;
  full_reasoning_chain: string;
  all_sources_used: string[];
  recommended_action: string;
}

export async function deepAnalyze(
  baseline: ClientBaseline,
  compositeResult: CompositeScoreResult,
  allEvidence: Evidence[],
  recentTxs: TransactionRecord[] = [],
): Promise<DeepAnalysisReport> {
  const timeSeriesSummary = summarizeTransactions(baseline, recentTxs);
  const user = buildStage3User(baseline, compositeResult, allEvidence, timeSeriesSummary);

  const { text } = await callLLM({
    stage: 3,
    model: MODEL,
    system: STAGE3_SYSTEM,
    user,
    maxTokens: 1200,
    signalId: `deep-${baseline.clientId}`,
    stub: () => stubDeep(baseline, compositeResult, allEvidence),
  });

  const parsed = extractJSON<Stage3JSON>(text);
  return {
    clientId: baseline.clientId,
    summary: parsed.summary,
    fullReasoningChain: parsed.full_reasoning_chain,
    allSourcesUsed: parsed.all_sources_used?.length ? parsed.all_sources_used : allEvidence.map((e) => e.sourceUrl),
    recommendedAction: parsed.recommended_action,
    generatedAt: new Date().toISOString(),
  };
}

function stubDeep(
  baseline: ClientBaseline,
  composite: CompositeScoreResult,
  evidence: Evidence[],
): string {
  const cats = composite.contributingSignals.map((s) => s.category).join(", ");
  return JSON.stringify({
    summary:
      `[STUB — no LLM key] ${baseline.legalName} scored ${composite.compositeScore}/100 (HIGH) driven by ${cats}. ` +
      `The client's recent activity has materially diverged from its onboarding KYC profile. ` +
      `A human compliance officer must approve any action before it is taken.`,
    full_reasoning_chain: composite.contributingSignals
      .map((s, i) => `${i + 1}. ${s.category}: ${s.rationale} (magnitude ${s.magnitude}, confidence ${s.confidence}).`)
      .join(" "),
    all_sources_used: evidence.map((e) => e.sourceUrl),
    recommended_action: "request enhanced KYC documents",
  });
}
