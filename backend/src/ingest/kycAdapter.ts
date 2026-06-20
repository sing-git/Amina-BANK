// Adapter: team KYC database (data/kyc_database.json) → our ClientBaseline[].
// Their schema (per company): { company_id, legal_name, domain, kyc_baseline:
// { expected_business_model, expected_activity_and_volumes, risk_rating }, key_personnel }.
import { readFileSync } from "node:fs";
import type { ClientBaseline } from "../types.js";

interface ExternalKyc {
  company_id: string;
  legal_name: string;
  domain?: string;
  kyc_baseline?: {
    expected_business_model?: string;
    expected_activity_and_volumes?: string;
    risk_rating?: string;
  };
  key_personnel?: Record<string, string>;
}

// "> 5 billion USD per month" → 5_000_000_000
function parseMonthlyVolume(text?: string): number {
  if (!text) return 1_000_000;
  const m = text.match(/([\d.]+)\s*(billion|million|bn|mn|m)\b/i);
  if (!m) return 1_000_000;
  const n = parseFloat(m[1]!);
  return m[2]!.toLowerCase().startsWith("b") ? n * 1e9 : n * 1e6;
}

function normRisk(r?: string): "low" | "medium" | "high" {
  const x = (r ?? "").toLowerCase();
  if (x.startsWith("h")) return "high";
  if (x.startsWith("l")) return "low";
  return "medium";
}

const DEFAULT_PATH = new URL("../../../data/kyc_database.json", import.meta.url);

export function loadBaselines(path: URL | string = DEFAULT_PATH): ClientBaseline[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as ExternalKyc[];
  return raw.map((k) => ({
    clientId: k.company_id,
    legalName: k.legal_name,
    jurisdiction: "unknown",
    legalForm: "unknown",
    onboardingDate: "2024-01-01",
    declaredBusinessDescription: [
      k.kyc_baseline?.expected_business_model,
      k.kyc_baseline?.expected_activity_and_volumes,
    ]
      .filter(Boolean)
      .join(". "),
    expectedMonthlyTxCount: 100,
    expectedMonthlyVolumeUSD: parseMonthlyVolume(k.kyc_baseline?.expected_activity_and_volumes),
    expectedCounterpartyRegions: [],
    // key personnel become screenable names (UBO slot) so the hard gate checks them too
    ubos: Object.values(k.key_personnel ?? {}).map((name) => ({ name, ownershipPct: 0, isPEP: false })),
    riskRating: normRisk(k.kyc_baseline?.risk_rating),
    isSynthetic: true,
    generatedBy: "manual",
  }));
}
