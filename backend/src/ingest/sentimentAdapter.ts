// Adapter: Giulio's company-level adverse-media sentiment (kyc_drift_signals.json →
// `sentiment_score`) → deterministic, pre-scored `negative_sentiment` signals.
//
// This is a STAGE-1 (free, no LLM) semantic signal: Giulio already ran the sentiment model, so
// we read the aggregate and turn it into a score directly (bypassing the embedding gate / Stage 2,
// like the registry + sanctions pre-scored signals).
//   - net NEGATIVE / high risk-polarity → a risk_increasing signal
//   - net POSITIVE                      → a `positive` signal (softens the score, capped by policy)
//   - neutral / weak                    → nothing
import { existsSync, readFileSync } from "node:fs";
import type { ClientBaseline, SignalScore } from "../types.js";

interface CompanySentiment {
  company_id: string;
  legal_name?: string;
  sentiment_score?: {
    score?: number; // -1..1  (negative = adverse, positive = benign)
    label?: "negative" | "neutral" | "positive";
    risk_polarity?: number; // 0..1 (higher = more adverse)
    adverse_ratio?: number; // 0..1 fraction of adverse articles
    article_count?: number;
  };
}

const DEFAULT_PATH = new URL("../../../scrapers/news-feed/kyc_drift_signals.json", import.meta.url);

// Tunables (kept deterministic / explainable; could move to riskPolicy later).
const NEG_POLARITY_MIN = 0.4; // risk_polarity ≥ this (or label "negative") → adverse signal
const POS_SCORE_MIN = 0.3; //    score ≥ this AND label "positive"        → softening signal

/** Returns { clientId → SignalScore[] }. Only companies with a usable sentiment aggregate. */
export function loadSentimentScores(
  baselines: ClientBaseline[],
  path: URL | string = DEFAULT_PATH,
): Record<string, SignalScore[]> {
  if (!existsSync(path)) return {};
  const report = JSON.parse(readFileSync(path, "utf8")) as CompanySentiment[];
  const known = new Set(baselines.map((b) => b.clientId));

  const out: Record<string, SignalScore[]> = {};
  for (const co of report) {
    const ss = co.sentiment_score;
    if (!ss || !known.has(co.company_id)) continue;
    const score = ss.score ?? 0;
    const polarity = ss.risk_polarity ?? 0;
    const adversePct = Math.round((ss.adverse_ratio ?? 0) * 100);
    const n = ss.article_count ?? 0;

    let sig: SignalScore | null = null;
    if (ss.label === "negative" || polarity >= NEG_POLARITY_MIN) {
      sig = {
        signalId: `sentiment-${co.company_id}`,
        category: "negative_sentiment",
        method: "rule_diff",
        magnitude: Math.round(Math.min(100, polarity * 100)),
        direction: "risk_increasing",
        rationale: `Adverse-media sentiment is net NEGATIVE (label ${ss.label}, risk-polarity ${polarity.toFixed(2)}, ${adversePct}% adverse) across ${n} recent articles.`,
        suggestedAction: "Review the adverse media coverage and reassess reputational/AML risk.",
        sourceCitations: ["news:sentiment-aggregate"],
        confidence: 0.7,
        isFraudTypology: false,
      };
    } else if (ss.label === "positive" && score >= POS_SCORE_MIN) {
      sig = {
        signalId: `sentiment-${co.company_id}`,
        category: "negative_sentiment",
        method: "rule_diff",
        magnitude: Math.round(Math.min(100, score * 100)),
        direction: "positive", // softens the composite (bounded by softeningFactor in policy)
        rationale: `Adverse-media sentiment is net POSITIVE (score +${score.toFixed(2)}, ${n} articles, no adverse coverage) — a mild risk softener, not a clearance.`,
        suggestedAction: "Note the favourable coverage; it does not override hard-gate or rule findings.",
        sourceCitations: ["news:sentiment-aggregate"],
        confidence: 0.6,
        isFraudTypology: false,
      };
    }
    if (sig) out[co.company_id] = [sig];
  }
  return out;
}
