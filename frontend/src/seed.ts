// Offline fallback so the dashboard renders even with no backend running.
// Same shape as GET /api/demo/alerts — swapped transparently in api.ts.
import type { Alert, Cost } from "./types";

export const SEED_COST: Cost = { calls: 3, totalUSD: 0.006495, costPer1000USD: 2.17 };

export const SEED_ALERTS: Alert[] = [
  {
    caseName: "Ostium Labs — real funding, correctly NOT escalated",
    baseline: {
      clientId: "CLT-OSTIUM",
      legalName: "Ostium Labs Inc.",
      jurisdiction: "United States",
      legalForm: "Inc.",
      onboardingDate: "2024-06-01",
      declaredBusinessDescription:
        "On-chain derivatives protocol enabling trading of traditional real-world assets such as commodities and forex on a decentralized exchange.",
      expectedMonthlyVolumeUSD: 2_000_000,
      riskRating: "medium",
      isSynthetic: true,
      generatedBy: "manual",
      ubos: [{ name: "Marco Antonacci", ownershipPct: 35, isPEP: false }],
    },
    composite: {
      clientId: "CLT-OSTIUM",
      compositeScore: 12,
      riskFlag: "low",
      contributingSignals: [
        {
          signalId: "SIG-OSTIUM-NEWS",
          category: "negative_news",
          method: "llm_classification",
          magnitude: 50,
          direction: "risk_increasing",
          confidence: 0.6,
          rationale:
            "Minor adverse mention in crypto press about leverage limits; low materiality and consistent with the declared derivatives business.",
          sourceCitations: ["https://example.com/ostium-series-a"],
        },
      ],
      neutralSignals: [
        {
          signalId: "SIG-OSTIUM-FUND",
          category: "funding_scale_change",
          method: "rule_diff",
          magnitude: 38,
          direction: "neutral_update",
          confidence: 0.8,
          rationale:
            "Funding changed from $3.5M to $20M (~5.7x Series A). Reassess transaction-monitoring thresholds — not risk-increasing on its own.",
          sourceCitations: ["https://www.crunchbase.com/organization/ostium-labs"],
        },
      ],
      hardGateTriggered: false,
    },
    stageTrace: [
      "Hard gate clear (no sanctions/PEP match).",
      "Rule diff: SIG-OSTIUM-FUND → funding scale change (magnitude 38) → neutral_update.",
      "Embedding gate PASSED → Stage 2 (Haiku): SIG-OSTIUM-NEWS → risk_increasing (magnitude 50, confidence 0.6).",
      "Composite score 12/100 → flag low.",
    ],
    evidenceBySignal: {
      "SIG-OSTIUM-NEWS": [
        {
          sourceUrl: "https://example.com/ostium-series-a",
          text: "Ostium Labs raises $20M Series A to expand its on-chain derivatives protocol for trading real-world assets.",
        },
      ],
      "SIG-OSTIUM-FUND": [
        { sourceUrl: "https://www.crunchbase.com/organization/ostium-labs", text: "Series A — $20M (previous $3.5M)." },
      ],
    },
  },
  {
    caseName: "NordPay — SaaS→crypto pivot + offshore surge → HIGH, escalated",
    baseline: {
      clientId: "CLT-NORDPAY",
      legalName: "NordPay Solutions GmbH",
      jurisdiction: "Germany",
      legalForm: "GmbH",
      onboardingDate: "2023-02-15",
      declaredBusinessDescription:
        "B2B SaaS company providing invoicing and payment-reconciliation software to small European enterprises. Operates within EU payment infrastructure.",
      expectedMonthlyVolumeUSD: 300_000,
      riskRating: "low",
      isSynthetic: true,
      generatedBy: "manual",
      ubos: [{ name: "Lena Hoffmann", ownershipPct: 60, isPEP: false }],
    },
    composite: {
      clientId: "CLT-NORDPAY",
      compositeScore: 100,
      riskFlag: "high",
      contributingSignals: [
        {
          signalId: "SIG-NORDPAY-PIVOT",
          category: "business_model_pivot",
          method: "llm_classification",
          magnitude: 85,
          direction: "risk_increasing",
          confidence: 0.7,
          rationale:
            "Public relaunch as a high-leverage crypto derivatives venue (up to 100x) contradicts the declared invoicing-software business — a material business-model change requiring re-KYC.",
          sourceCitations: ["https://example.com/nordpay-crypto"],
        },
        {
          signalId: "SIG-NORDPAY-TX",
          category: "cross_border_anomaly",
          method: "rule_diff",
          magnitude: 100,
          direction: "risk_increasing",
          confidence: 0.9,
          rationale:
            "Last-30-day volume of $3,300,000 is ~1000% vs the expected $300,000, with 3 outbound transfers to unexpected offshore regions: Seychelles, Cayman Islands.",
          sourceCitations: ["internal:tx-monitor:CLT-NORDPAY"],
        },
      ],
      neutralSignals: [],
      hardGateTriggered: false,
    },
    deepAnalysis: {
      summary:
        "NordPay Solutions GmbH scored 100/100 (HIGH), driven by a business-model pivot and a cross-border transaction anomaly. The client's recent activity has materially diverged from its onboarding KYC profile. A human compliance officer must approve any action before it is taken.",
      fullReasoningChain:
        "1. The declared business was EU invoicing SaaS (risk rating low). 2. Public news shows a relaunch as a 100x crypto derivatives venue — a material business-model change. 3. Transaction monitoring shows a ~10x volume surge with large outbound transfers to Seychelles and the Cayman Islands, inconsistent with the declared EU-only profile. 4. Together these indicate the original KYC assumptions are invalid.",
      recommendedAction: "request enhanced KYC documents",
      allSourcesUsed: ["https://example.com/nordpay-crypto", "internal:tx-monitor:CLT-NORDPAY"],
    },
    stageTrace: [
      "Hard gate clear (no sanctions/PEP match).",
      "Embedding gate PASSED → Stage 2 (Haiku): SIG-NORDPAY-PIVOT → risk_increasing (magnitude 85, confidence 0.7).",
      "Rule diff: SIG-NORDPAY-TX → cross_border_anomaly (magnitude 100).",
      "Composite score 100/100 → flag high.",
      "HIGH → Stage 3 (Sonnet) deep analysis generated. Recommended: request enhanced KYC documents.",
    ],
    evidenceBySignal: {
      "SIG-NORDPAY-PIVOT": [
        {
          sourceUrl: "https://example.com/nordpay-crypto",
          text: "NordPay relaunches as a high-leverage crypto derivatives trading venue offering up to 100x leverage on digital assets, moving away from its original invoicing software business.",
        },
      ],
    },
  },
  {
    caseName: "Blocked Holdings — sanctions hard gate → CRITICAL",
    baseline: {
      clientId: "CLT-BLOCKED",
      legalName: "Blocked Holdings Ltd",
      jurisdiction: "Cyprus",
      legalForm: "Ltd",
      onboardingDate: "2022-08-01",
      declaredBusinessDescription: "Commodities trading and logistics intermediary.",
      expectedMonthlyVolumeUSD: 1_000_000,
      riskRating: "high",
      isSynthetic: true,
      generatedBy: "manual",
      ubos: [{ name: "Ivan Petrov", ownershipPct: 100, isPEP: false }],
    },
    composite: {
      clientId: "CLT-BLOCKED",
      compositeScore: 100,
      riskFlag: "critical",
      contributingSignals: [],
      neutralSignals: [],
      hardGateTriggered: true,
      hardGateReason: "Sanctions/PEP exact match: Blocked Holdings Ltd",
    },
    stageTrace: [
      'HARD GATE: sanctions/PEP match on "Blocked Holdings Ltd" → CRITICAL, pipeline short-circuited.',
    ],
    evidenceBySignal: {},
  },
];
