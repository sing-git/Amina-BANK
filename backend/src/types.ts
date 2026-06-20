// All shared types for the AMINA Dynamic Risk Profiling pipeline.
// Mirrors `architecure plan/amina-technical-architecture-spec.md` section 2.

// ── Layer 2: synthetic internal data ──────────────────────────────

export interface ClientBaseline {
  clientId: string;
  legalName: string;
  jurisdiction: string;
  legalForm: string;
  onboardingDate: string; // ISO date
  declaredBusinessDescription: string; // the embedding anchor text
  expectedMonthlyTxCount: number;
  expectedMonthlyVolumeUSD: number;
  expectedCounterpartyRegions: string[];
  ubos: Array<{ name: string; ownershipPct: number; isPEP: boolean }>;
  riskRating: "low" | "medium" | "high";
  isSynthetic: true; // always true — for audit/UI labeling
  generatedBy?: SyntheticModel; // which model produced this record (multi-model story)
}

export type SyntheticModel = "claude" | "gemini" | "openai" | "azure" | "manual";

export type RiskFlag = "low" | "medium" | "high" | "critical";

export interface TransactionRecord {
  txId: string;
  clientId: string;
  date: string; // ISO date
  amountUSD: number;
  counterpartyRegion: string;
  direction: "inbound" | "outbound";
  isSynthetic: true;
  generatedBy?: SyntheticModel;
}

// ── Layer 1: incoming raw signal ──────────────────────────────────

export type SignalCategory =
  // ── original 10 ──
  | "negative_news"
  | "cross_border_anomaly"
  | "structuring_pattern"
  | "entity_name_change"
  | "domain_change"
  | "business_model_pivot"
  | "jurisdiction_change"
  | "ownership_change"
  | "funding_scale_change"
  | "dormancy_break"
  // ── extended drift taxonomy ──
  | "legal_regulatory_action" // lawsuits, fines, investigations (news)
  | "key_personnel_change" // CEO/CFO/board change (news/registry)
  | "pep_exposure" // a UBO/officer becomes politically exposed
  | "nominee_ownership" // beneficial-owner obfuscation, shell layering (ICIJ)
  | "legal_form_change" // e.g. GmbH → offshore IBC (registry)
  | "website_content_change" // site says it does something different now
  | "rapid_geographic_expansion" // sudden expansion into many/high-risk jurisdictions
  | "unexplained_volume_surge" // activity jump unexplained by stated business
  | "negative_sentiment"; // adverse-media sentiment subtype

export interface RawSignal {
  signalId: string;
  clientId: string;
  category: SignalCategory;
  detectedAt: string;
  sourceType: "news" | "registry" | "domain" | "transaction" | "funding_db";
  sourceUrl?: string;
  rawText?: string; // for narrative signals
  newsQuery?: string; // for LIVE news: a company name/query to fetch real articles via the news MCP
  rawNumeric?: number; // for numeric signals
  rawNumericContext?: Record<string, number>; // e.g. { previousValue: 0, currentValue: 50 }
}

// ── Pipeline outputs ───────────────────────────────────────────────

export interface SignalScore {
  signalId: string;
  category: SignalCategory;
  method: "rule_diff" | "embedding" | "llm_classification";
  magnitude: number; // 0–100, "how big is the change"
  direction: "risk_increasing" | "neutral_update" | "positive" | "unknown";
  rationale: string; // human-readable, plain language
  suggestedAction: string; // concrete next step a compliance officer can take
  sourceCitations: string[]; // URLs or source IDs referenced
  confidence: number; // 0–1
  isFraudTypology?: boolean; // true for AML/fraud patterns (money mule, structuring, dormancy)
}

export interface CompositeScoreResult {
  clientId: string;
  compositeScore: number; // 0–100
  riskFlag: "low" | "medium" | "high" | "critical";
  contributingSignals: SignalScore[];
  neutralSignals: SignalScore[]; // trigger threshold-refresh workflow, not the score
  hardGateTriggered: boolean;
  hardGateReason?: string;
}

export interface DeepAnalysisReport {
  clientId: string;
  summary: string;
  fullReasoningChain: string;
  allSourcesUsed: string[];
  recommendedAction: string;
  generatedAt: string;
}

// ── Cost instrumentation (judging deliverable) ─────────────────────

export interface CostLogEntry {
  stage: 2 | 3;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUSD: number;
  signalId: string;
  timestamp: string;
}

export interface SignalWeightsConfig {
  version: string;
  approvedBy: string;
  weights: Record<SignalCategory, number>;
}
