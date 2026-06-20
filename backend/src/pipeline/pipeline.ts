// Orchestrator. Routes each signal through the cheapest sufficient stage:
//   hard gate → rule diff / embedding gate → Stage 2 (Haiku) → scoring → Stage 3 (Sonnet)
// See spec section 3.7.
import type {
  ClientBaseline,
  CompositeScoreResult,
  DeepAnalysisReport,
  RawSignal,
  SignalScore,
  TransactionRecord,
} from "../types.js";
import { checkSanctionsPEP } from "./hardGate.js";
import { checkFundingScale, runTransactionChecks } from "./ruleDiff.js";
import { classifyRawSignal } from "./classifyRawSignal.js";
import { POLICY } from "./policy.js";
import { buildArchetypeEmbeddings, embed, scoreNarrativeSignal } from "./embeddings.js";
import { classifySignal } from "./stage2Classify.js";
import { computeCompositeScore } from "./scoringEngine.js";
import { deepAnalyze } from "./stage3DeepAnalysis.js";
import { fetchEvidenceViaMCP, type Evidence } from "./mcpNews.js";

export interface PipelineResult {
  composite: CompositeScoreResult;
  deepAnalysis?: DeepAnalysisReport;
  evidenceBySignal: Record<string, Evidence[]>;
  stageTrace: string[]; // human-readable "what happened, in order" for the UI/audit
}

export async function runPipeline(
  baseline: ClientBaseline,
  recentTxs: TransactionRecord[],
  incomingSignals: RawSignal[],
): Promise<PipelineResult> {
  const stageTrace: string[] = [];
  const evidenceBySignal: Record<string, Evidence[]> = {};

  // ── Hard gate (sanctions/PEP) — short-circuits everything ──
  const hardGateResult = await checkSanctionsPEP(baseline.legalName, baseline.ubos);
  if (hardGateResult.matched) {
    stageTrace.push(`HARD GATE: sanctions/PEP match on "${hardGateResult.matchedEntity}" → CRITICAL, pipeline short-circuited.`);
    const composite = computeCompositeScore([], hardGateResult);
    composite.clientId = baseline.clientId;
    return { composite, evidenceBySignal, stageTrace };
  }
  stageTrace.push("Hard gate clear (no sanctions/PEP match).");

  // Cache baseline + archetype embeddings once (see runbook D4).
  const baselineEmbedding = await embed(baseline.declaredBusinessDescription);
  const archetypeEmbeddings = await buildArchetypeEmbeddings();

  const scores: SignalScore[] = [];

  for (const signal of incomingSignals) {
    // classifyRawSignal() decides the route (spec §1 diagram): numeric | narrative.
    // (identity = the hard gate above, which screens names before this loop.)
    const route = classifyRawSignal(signal);

    // ── NUMERIC route → pure rules, no LLM ──
    if (route === "numeric") {
      if (signal.sourceType === "transaction") {
        const txScores = runTransactionChecks(baseline, recentTxs);
        if (txScores.length) {
          scores.push(...txScores);
          for (const s of txScores) {
            stageTrace.push(
              `Numeric → ruleDiff: ${s.category}${s.isFraudTypology ? " [FRAUD/AML]" : ""} (magnitude ${s.magnitude}).`,
            );
          }
        } else {
          stageTrace.push(`Numeric → ruleDiff: ${signal.signalId} → within normal range, discarded (no LLM cost).`);
        }
      } else {
        // funding_db
        const s = checkFundingScale(signal);
        if (s) {
          scores.push(s);
          stageTrace.push(`Numeric → ruleDiff: ${signal.signalId} → funding scale change (magnitude ${s.magnitude}).`);
        }
      }
      continue;
    }

    // ── NARRATIVE route → embedding gate BEFORE any LLM call ──
    // LIVE news (newsQuery set): we only have a company name, so we must fetch the
    // real articles first and run the gate on THEIR text. Fetching news is cheap
    // (no LLM). Otherwise we gate on the signal's own rawText, fetching only if it passes.
    let evidence: Evidence[] = [];
    let narrativeText = signal.rawText ?? "";
    if (signal.newsQuery) {
      evidence = await fetchEvidenceViaMCP(signal);
      evidenceBySignal[signal.signalId] = evidence;
      narrativeText = evidence.map((e) => e.text).join(" ") || narrativeText;
      stageTrace.push(`News MCP: "${signal.newsQuery}" → fetched ${evidence.length} article(s).`);
    }

    const embedScores = await scoreNarrativeSignal(baselineEmbedding, archetypeEmbeddings, narrativeText);
    const worthReviewing =
      embedScores.baselineSimilarity < POLICY.embeddingGate.baselineSimMax ||
      (embedScores.archetypeMatches[0]?.similarity ?? 0) > POLICY.embeddingGate.archetypeSimMin;

    if (!worthReviewing) {
      stageTrace.push(
        `Embedding gate: ${signal.signalId} → baselineSim ${embedScores.baselineSimilarity.toFixed(2)}, nothing notable, discarded (no LLM cost).`,
      );
      continue;
    }

    if (evidence.length === 0) {
      evidence = await fetchEvidenceViaMCP(signal);
      evidenceBySignal[signal.signalId] = evidence;
    }
    const classified = await classifySignal(baseline, signal, embedScores, evidence);
    scores.push(classified);
    stageTrace.push(
      `Embedding gate PASSED → Stage 2 (Haiku): ${signal.signalId} → ${classified.direction} (magnitude ${classified.magnitude}, confidence ${classified.confidence}).`,
    );
  }

  // ── Filter weak signals (policy-driven) — drop only if BOTH confidence and magnitude
  //    are below the floor. Keeps the alert focused; logged for audit. ──
  const kept = scores.filter((s) => {
    const weak = s.confidence < POLICY.signalFilter.minConfidence && s.magnitude < POLICY.signalFilter.minMagnitude;
    if (weak) {
      stageTrace.push(
        `Filtered weak signal: ${s.category} (confidence ${s.confidence} < ${POLICY.signalFilter.minConfidence} AND magnitude ${s.magnitude} < ${POLICY.signalFilter.minMagnitude}).`,
      );
    }
    return !weak;
  });

  // ── Aggregate ──
  const composite = computeCompositeScore(kept, hardGateResult);
  composite.clientId = baseline.clientId;
  stageTrace.push(`Composite score ${composite.compositeScore}/100 → flag ${composite.riskFlag}.`);

  // ── Escalate only HIGH to Stage 3 (Sonnet) ──
  if (composite.riskFlag === "high") {
    const allEvidence = Object.values(evidenceBySignal).flat();
    const deepAnalysis = await deepAnalyze(baseline, composite, allEvidence);
    stageTrace.push(`HIGH → Stage 3 (Sonnet) deep analysis generated. Recommended: ${deepAnalysis.recommendedAction}.`);
    return { composite, deepAnalysis, evidenceBySignal, stageTrace };
  }

  return { composite, evidenceBySignal, stageTrace };
}
