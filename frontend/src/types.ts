export type RiskFlag = "low" | "medium" | "high" | "critical";

export interface SignalScore {
  signalId: string;
  category: string;
  method: string;
  magnitude: number; // 0-100
  direction: "risk_increasing" | "neutral_update" | "positive" | "unknown";
  rationale: string;
  sourceCitations: string[];
  confidence: number; // 0-1
}

export interface ClientBaseline {
  clientId: string;
  legalName: string;
  jurisdiction: string;
  legalForm: string;
  onboardingDate: string;
  declaredBusinessDescription: string;
  expectedMonthlyVolumeUSD: number;
  riskRating: "low" | "medium" | "high";
  isSynthetic: true;
  generatedBy?: string;
  ubos: { name: string; ownershipPct: number; isPEP: boolean }[];
}

export interface Composite {
  clientId: string;
  compositeScore: number;
  riskFlag: RiskFlag;
  contributingSignals: SignalScore[];
  neutralSignals: SignalScore[];
  hardGateTriggered: boolean;
  hardGateReason?: string;
}

export interface DeepAnalysis {
  summary: string;
  fullReasoningChain: string;
  recommendedAction: string;
  allSourcesUsed: string[];
}

export interface Alert {
  caseName: string;
  baseline: ClientBaseline;
  composite: Composite;
  deepAnalysis?: DeepAnalysis;
  stageTrace: string[];
  evidenceBySignal: Record<string, { sourceUrl: string; text: string }[]>;
}

export interface Cost {
  calls: number;
  totalUSD: number;
  stage2USD?: number;
  stage3USD?: number;
  costPer1000USD: number;
}

export interface AuditEntry {
  ts: string;
  clientId: string;
  actor: string;
  action: string;
  detail: string;
}
