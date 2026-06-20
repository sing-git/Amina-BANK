// Adversarial jury for HIGH cases: a prosecutor argues the risk is REAL, a defense argues it
// is BENIGN, then a judge weighs both and decides. This makes the escalation decision
// explainable (both sides on record) and harder to fool than a single opinion.
// Cost: prosecutor + defense run cheap (Stage 2 tier); the judge runs on the quality tier.
import type { ClientBaseline, CompositeScoreResult } from "../types.js";
import { callLLM, extractJSON } from "./llm.js";
import type { Evidence } from "./mcpNews.js";

export interface JuryVerdict {
  verdict: "risk_confirmed" | "overturned" | "uncertain";
  confidence: number; // 0-1
  prosecutionArgument: string;
  defenseArgument: string;
  judgeReasoning: string;
  recommendedAction: string;
}

interface JudgeJSON {
  verdict: "risk_confirmed" | "overturned" | "uncertain";
  confidence: number;
  judge_reasoning: string;
  recommended_action: string;
}

function context(baseline: ClientBaseline, composite: CompositeScoreResult, evidence: Evidence[]): string {
  const signals = composite.contributingSignals
    .map((s) => `- ${s.category} | ${s.direction} | magnitude ${s.magnitude} | ${s.rationale}`)
    .join("\n");
  const ev = evidence.map((e) => `- [${e.sourceUrl}]: ${e.text}`).join("\n") || "- (none)";
  return `CLIENT: ${baseline.legalName} (declared: ${baseline.declaredBusinessDescription})
COMPOSITE SCORE: ${composite.compositeScore}/100 (${composite.riskFlag})
CONTRIBUTING SIGNALS:
${signals}
EVIDENCE:
${ev}`;
}

export async function runJury(
  baseline: ClientBaseline,
  composite: CompositeScoreResult,
  evidence: Evidence[],
): Promise<JuryVerdict> {
  const ctx = context(baseline, composite, evidence);

  const { text: prosecution } = await callLLM({
    stage: 2,
    model: "claude-haiku-4-5-20251001",
    system:
      "You are a compliance RISK PROSECUTOR. Using ONLY the evidence given, argue that this client " +
      "poses a genuine, actionable risk requiring escalation. Be specific, cite sources. 3-5 sentences.",
    user: ctx,
    maxTokens: 300,
    signalId: `jury-pros-${baseline.clientId}`,
    stub: () =>
      `[STUB] Prosecution: the contributing signals (${composite.contributingSignals.map((s) => s.category).join(", ")}) ` +
      `show the client's activity has materially diverged from its declared profile, consistent with elevated AML risk.`,
  });

  const { text: defense } = await callLLM({
    stage: 2,
    model: "claude-haiku-4-5-20251001",
    system:
      "You are a compliance RISK DEFENSE. Using ONLY the evidence given, argue that the apparent risk " +
      "has a benign explanation or is overstated (e.g. legitimate growth, misattribution). Be specific. 3-5 sentences.",
    user: ctx,
    maxTokens: 300,
    signalId: `jury-def-${baseline.clientId}`,
    stub: () =>
      `[STUB] Defense: the signals may reflect legitimate business growth or routine corporate change; ` +
      `none is independently corroborated, so the risk could be overstated pending verification.`,
  });

  const { text: judgeText } = await callLLM({
    stage: 3,
    model: "claude-sonnet-4-6",
    system:
      "You are the compliance JUDGE. Weigh the prosecution and defense arguments against the evidence and " +
      "decide whether the risk is real. This is advisory; a human approves any action. Return ONLY JSON.",
    user: `${ctx}

PROSECUTION:
${prosecution}

DEFENSE:
${defense}

Return ONLY:
{
  "verdict": "risk_confirmed" | "overturned" | "uncertain",
  "confidence": <0-1 float>,
  "judge_reasoning": "<2-3 sentences weighing both sides>",
  "recommended_action": "<one of: file SAR, request enhanced KYC documents, escalate to senior compliance, no action needed>"
}`,
    maxTokens: 400,
    signalId: `jury-judge-${baseline.clientId}`,
    stub: () =>
      JSON.stringify({
        verdict: composite.compositeScore >= 60 ? "risk_confirmed" : "uncertain",
        confidence: 0.6,
        judge_reasoning:
          "[STUB] The prosecution's drift evidence outweighs the defense's benign framing given the composite score; a human must verify before action.",
        recommended_action: "request enhanced KYC documents",
      }),
  });

  const judged = extractJSON<JudgeJSON>(judgeText);
  return {
    verdict: judged.verdict,
    confidence: Math.max(0, Math.min(1, judged.confidence)),
    prosecutionArgument: prosecution.trim(),
    defenseArgument: defense.trim(),
    judgeReasoning: judged.judge_reasoning,
    recommendedAction: judged.recommended_action,
  };
}
