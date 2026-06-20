// Labeled evaluation set. Each case has a KNOWN ground-truth label (the scenario we
// injected), so we can measure whether the pipeline flags it correctly. This is how we
// know "right vs wrong" on synthetic data — the label is controlled, not guessed.
// Same principle as SAML-D / AMLSim: inject a known typology, check it's detected.
import type { ClientBaseline, RawSignal, RiskFlag, SignalCategory, TransactionRecord } from "../types.js";

export interface LabeledCase {
  name: string;
  scenario: string; // the ground-truth label we injected
  baseline: ClientBaseline;
  txs: TransactionRecord[];
  signals: RawSignal[];
  expect: {
    minFlag?: RiskFlag; // pipeline flag must be at least this severe
    maxFlag?: RiskFlag; // ...and at most this severe (for "normal" cases)
    categories?: SignalCategory[]; // these categories MUST appear among contributing signals
    fraud?: boolean; // at least one contributing signal must be a fraud typology
  };
}

const base = (over: Partial<ClientBaseline>): ClientBaseline => ({
  clientId: "CLT-X",
  legalName: "Test Co",
  jurisdiction: "Germany",
  legalForm: "GmbH",
  onboardingDate: "2023-01-01",
  declaredBusinessDescription: "B2B SaaS invoicing software for small European enterprises within EU payment infrastructure.",
  expectedMonthlyTxCount: 25,
  expectedMonthlyVolumeUSD: 300_000,
  expectedCounterpartyRegions: ["European Union", "Germany"],
  ubos: [{ name: "Jane Doe", ownershipPct: 100, isPEP: false }],
  riskRating: "low",
  isSynthetic: true,
  generatedBy: "manual",
  ...over,
});

const tx = (id: string, date: string, amountUSD: number, region: string, direction: "inbound" | "outbound"): TransactionRecord => ({
  txId: id,
  clientId: "CLT-X",
  date,
  amountUSD,
  counterpartyRegion: region,
  direction,
  isSynthetic: true,
});

const txSignal: RawSignal = { signalId: "S-TX", clientId: "CLT-X", category: "cross_border_anomaly", detectedAt: "2026-05-20", sourceType: "transaction" };

export const LABELED_CASES: LabeledCase[] = [
  {
    name: "Normal client — activity matches baseline",
    scenario: "normal",
    baseline: base({ clientId: "CLT-NORMAL" }),
    txs: [
      tx("n1", "2026-05-05", 60_000, "Germany", "inbound"),
      tx("n2", "2026-05-15", 55_000, "European Union", "inbound"),
      tx("n3", "2026-05-25", 50_000, "Germany", "outbound"),
    ],
    signals: [{ ...txSignal, clientId: "CLT-NORMAL" }],
    expect: { maxFlag: "low" },
  },
  {
    name: "Structuring — 5 transfers just under $10k",
    scenario: "structuring",
    baseline: base({ clientId: "CLT-STRUCT" }),
    txs: [
      tx("s1", "2026-05-03", 9_400, "Germany", "outbound"),
      tx("s2", "2026-05-07", 9_200, "Germany", "outbound"),
      tx("s3", "2026-05-11", 9_600, "Germany", "outbound"),
      tx("s4", "2026-05-16", 9_100, "Germany", "outbound"),
      tx("s5", "2026-05-22", 9_800, "Germany", "outbound"),
    ],
    signals: [{ ...txSignal, clientId: "CLT-STRUCT" }],
    expect: { categories: ["structuring_pattern"], fraud: true },
  },
  {
    name: "Money mule — funds pass straight through to offshore",
    scenario: "money_mule",
    baseline: base({ clientId: "CLT-MULE" }),
    txs: [
      tx("m1", "2026-05-04", 1_000_000, "European Union", "inbound"),
      tx("m2", "2026-05-06", 480_000, "Seychelles", "outbound"),
      tx("m3", "2026-05-09", 510_000, "Cayman Islands", "outbound"),
    ],
    signals: [{ ...txSignal, clientId: "CLT-MULE" }],
    expect: { categories: ["cross_border_anomaly"], fraud: true },
  },
  {
    name: "Dormancy break — 200-day gap then surge",
    scenario: "dormancy_break",
    baseline: base({ clientId: "CLT-DORM" }),
    txs: [
      tx("d1", "2025-09-01", 40_000, "Germany", "inbound"),
      tx("d2", "2026-04-20", 900_000, "Germany", "outbound"),
      tx("d3", "2026-05-02", 850_000, "Germany", "outbound"),
    ],
    signals: [{ ...txSignal, clientId: "CLT-DORM" }],
    expect: { categories: ["dormancy_break"], fraud: true },
  },
  {
    name: "Sanctioned entity — hard gate",
    scenario: "sanctions",
    baseline: base({ clientId: "CLT-SANC", legalName: "Blocked Holdings Ltd" }),
    txs: [],
    signals: [],
    expect: { minFlag: "critical" },
  },
];
