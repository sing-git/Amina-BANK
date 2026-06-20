// Hand-authored demo fixtures (clearly synthetic). Multi-model generators in
// data/generators/ will produce more of these at scale; these two drive the demo.
import type { ClientBaseline, RawSignal, TransactionRecord } from "../types.js";

// ── Case A: Ostium Labs — real funding news, expected to read as neutral_update ──
export const ostiumBaseline: ClientBaseline = {
  clientId: "CLT-OSTIUM",
  legalName: "Ostium Labs Inc.",
  jurisdiction: "United States",
  legalForm: "C-Corp",
  onboardingDate: "2024-06-01",
  declaredBusinessDescription:
    "On-chain derivatives protocol enabling trading of traditional real-world assets such as commodities and forex on a decentralized exchange.",
  expectedMonthlyTxCount: 40,
  expectedMonthlyVolumeUSD: 2_000_000,
  expectedCounterpartyRegions: ["United States", "European Union", "United Kingdom"],
  ubos: [{ name: "Marco Antonacci", ownershipPct: 35, isPEP: false }],
  riskRating: "medium",
  isSynthetic: true,
  generatedBy: "manual",
};

export const ostiumTxs: TransactionRecord[] = [
  { txId: "T1", clientId: "CLT-OSTIUM", date: "2026-05-03", amountUSD: 480_000, counterpartyRegion: "United States", direction: "inbound", isSynthetic: true },
  { txId: "T2", clientId: "CLT-OSTIUM", date: "2026-05-12", amountUSD: 510_000, counterpartyRegion: "European Union", direction: "outbound", isSynthetic: true },
  { txId: "T3", clientId: "CLT-OSTIUM", date: "2026-05-21", amountUSD: 460_000, counterpartyRegion: "United Kingdom", direction: "inbound", isSynthetic: true },
  { txId: "T4", clientId: "CLT-OSTIUM", date: "2026-05-29", amountUSD: 530_000, counterpartyRegion: "United States", direction: "outbound", isSynthetic: true },
];

export const ostiumSignals: RawSignal[] = [
  {
    signalId: "SIG-OSTIUM-FUND",
    clientId: "CLT-OSTIUM",
    category: "funding_scale_change",
    detectedAt: "2025-12-10",
    sourceType: "funding_db",
    sourceUrl: "https://www.crunchbase.com/organization/ostium-labs",
    rawNumericContext: { previousFundingUSD: 3_500_000, currentFundingUSD: 20_000_000 },
  },
  {
    signalId: "SIG-OSTIUM-NEWS",
    clientId: "CLT-OSTIUM",
    category: "negative_news",
    detectedAt: "2025-12-11",
    sourceType: "news",
    sourceUrl: "https://example.com/ostium-series-a",
    rawText:
      "Ostium Labs raises $20M Series A to expand its on-chain derivatives protocol for trading real-world assets. Funds will grow the engineering team and expand to new markets.",
  },
];

// ── Case B: composite pivot (synthetic) — SaaS startup quietly pivoting to crypto ──
export const pivotBaseline: ClientBaseline = {
  clientId: "CLT-NORDPAY",
  legalName: "NordPay Solutions GmbH",
  jurisdiction: "Germany",
  legalForm: "GmbH",
  onboardingDate: "2023-02-15",
  declaredBusinessDescription:
    "B2B SaaS company providing invoicing and payment-reconciliation software to small European enterprises. Operates within EU payment infrastructure.",
  expectedMonthlyTxCount: 25,
  expectedMonthlyVolumeUSD: 300_000,
  expectedCounterpartyRegions: ["European Union", "Germany"],
  ubos: [{ name: "Lena Hoffmann", ownershipPct: 60, isPEP: false }],
  riskRating: "low",
  isSynthetic: true,
  generatedBy: "manual",
};

export const pivotTxs: TransactionRecord[] = [
  // normal baseline activity
  { txId: "P1", clientId: "CLT-NORDPAY", date: "2025-09-05", amountUSD: 70_000, counterpartyRegion: "Germany", direction: "inbound", isSynthetic: true },
  { txId: "P2", clientId: "CLT-NORDPAY", date: "2025-10-06", amountUSD: 80_000, counterpartyRegion: "European Union", direction: "inbound", isSynthetic: true },
  // dormant gap (no tx Nov 2025 – Apr 2026) then a cross-border surge
  { txId: "P3", clientId: "CLT-NORDPAY", date: "2026-05-02", amountUSD: 900_000, counterpartyRegion: "Seychelles", direction: "outbound", isSynthetic: true },
  { txId: "P4", clientId: "CLT-NORDPAY", date: "2026-05-09", amountUSD: 1_100_000, counterpartyRegion: "Seychelles", direction: "outbound", isSynthetic: true },
  { txId: "P5", clientId: "CLT-NORDPAY", date: "2026-05-18", amountUSD: 1_300_000, counterpartyRegion: "Cayman Islands", direction: "outbound", isSynthetic: true },
];

export const pivotSignals: RawSignal[] = [
  {
    signalId: "SIG-NORDPAY-PIVOT",
    clientId: "CLT-NORDPAY",
    category: "business_model_pivot",
    detectedAt: "2026-05-20",
    sourceType: "news",
    sourceUrl: "https://example.com/nordpay-crypto",
    rawText:
      "NordPay relaunches as a high-leverage crypto derivatives trading venue offering up to 100x leverage on digital assets, moving away from its original invoicing software business.",
  },
  {
    signalId: "SIG-NORDPAY-TX",
    clientId: "CLT-NORDPAY",
    category: "cross_border_anomaly",
    detectedAt: "2026-05-19",
    sourceType: "transaction",
  },
];

// ── Case C: sanctions hit — demonstrates the hard gate ──
export const sanctionedBaseline: ClientBaseline = {
  clientId: "CLT-BLOCKED",
  legalName: "Blocked Holdings Ltd",
  jurisdiction: "Cyprus",
  legalForm: "Ltd",
  onboardingDate: "2022-08-01",
  declaredBusinessDescription: "Commodities trading and logistics intermediary.",
  expectedMonthlyTxCount: 30,
  expectedMonthlyVolumeUSD: 1_000_000,
  expectedCounterpartyRegions: ["European Union"],
  ubos: [{ name: "Ivan Petrov", ownershipPct: 100, isPEP: false }],
  riskRating: "high",
  isSynthetic: true,
  generatedBy: "manual",
};

export const demoCases = [
  { name: "Ostium Labs (real funding → expected neutral)", baseline: ostiumBaseline, txs: ostiumTxs, signals: ostiumSignals },
  { name: "NordPay pivot (synthetic → expected HIGH escalation)", baseline: pivotBaseline, txs: pivotTxs, signals: pivotSignals },
  { name: "Blocked Holdings (sanctions → CRITICAL hard gate)", baseline: sanctionedBaseline, txs: [], signals: [] },
];
