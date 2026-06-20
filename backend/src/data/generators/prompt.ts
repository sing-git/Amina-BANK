// Shared generation contract used by EVERY provider, so Claude/Gemini/OpenAI/Azure
// all fill the SAME schema — only `generatedBy` differs. This is the multi-model
// diversity story: no single-model bias in the synthetic demo/training data.

export interface GenSeed {
  sector: string; // e.g. "B2B SaaS invoicing", "on-chain derivatives"
  jurisdiction: string; // e.g. "Germany"
  scenario: "normal" | "pivot" | "structuring" | "dormancy_break"; // what drift (if any) to embed
}

export const GEN_SYSTEM =
  "You generate SYNTHETIC bank KYC records for a compliance demo. The data is fictional. " +
  "Apply a FATF-aligned 4-factor risk rubric to set riskRating: Geographic, Customer, " +
  "Product/Service, Channel. Return STRICT JSON only — no prose, no markdown fences.";

export function buildGenUser(seed: GenSeed): string {
  return `Create one synthetic client and 6-10 transactions.

SEED
Sector: ${seed.sector}
Jurisdiction: ${seed.jurisdiction}
Drift scenario to embed in the transactions: ${seed.scenario}
  - "normal": activity matches the declared profile
  - "pivot": late transactions hint at a different, riskier business than declared
  - "structuring": several just-below-threshold transfers
  - "dormancy_break": a long inactive gap then a sudden large surge

Return STRICT JSON exactly in this shape:
{
  "baseline": {
    "clientId": "<short id>",
    "legalName": "<fictional name>",
    "jurisdiction": "${seed.jurisdiction}",
    "legalForm": "<e.g. GmbH, Ltd, Inc>",
    "onboardingDate": "<ISO date>",
    "declaredBusinessDescription": "<2-3 sentences>",
    "expectedMonthlyTxCount": <int>,
    "expectedMonthlyVolumeUSD": <int>,
    "expectedCounterpartyRegions": ["<region>", "..."],
    "ubos": [{ "name": "<name>", "ownershipPct": <int>, "isPEP": <bool> }],
    "riskRating": "low" | "medium" | "high"
  },
  "transactions": [
    { "txId": "<id>", "date": "<ISO date>", "amountUSD": <int>, "counterpartyRegion": "<region>", "direction": "inbound" | "outbound" }
  ]
}`;
}
