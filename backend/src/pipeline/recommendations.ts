// Actionable recommendations + fraud-typology classification.
// The default actions are taken verbatim from README's "Use Cases" table
// ("Recommended Action" column) so the system's advice is traceable to the brief,
// not invented. Stage 2's LLM may override with a context-specific action; if it
// doesn't, we fall back to this map.
import type { SignalCategory } from "../types.js";

export const RECOMMENDED_ACTIONS: Record<SignalCategory, string> = {
  negative_news: "Trigger enhanced due diligence; escalate to compliance review",
  cross_border_anomaly: "Monitor transactions; flag for AML analyst review",
  structuring_pattern: "Trigger AML investigation",
  entity_name_change: "Trigger KYC refresh; re-evaluate risk category",
  domain_change: "Re-analyse website content; compare vs. original onboarding data",
  business_model_pivot: "Update risk classification; escalate for compliance review",
  jurisdiction_change: "Trigger enhanced due diligence; re-check beneficial ownership",
  ownership_change: "Full ownership verification; re-screen against sanctions/PEP lists",
  funding_scale_change: "Reassess transaction-monitoring thresholds; update activity profile",
  dormancy_break: "Trigger AML review; validate business legitimacy",
  legal_regulatory_action: "Trigger enhanced due diligence; assess legal/regulatory exposure",
  key_personnel_change: "Re-verify management; update KYC personnel records",
  pep_exposure: "Apply enhanced due diligence; senior management sign-off required",
  nominee_ownership: "Full beneficial-ownership verification; re-screen UBOs against sanctions/PEP",
  legal_form_change: "Trigger re-KYC; reassess structural risk",
  website_content_change: "Re-analyse website; compare vs. original onboarding business description",
  rapid_geographic_expansion: "Reassess transaction-monitoring thresholds and geographic risk",
  unexplained_volume_surge: "Trigger AML review; validate source of funds",
  negative_sentiment: "Monitor adverse media; escalate if corroborated",
};

// AML/fraud typologies — transaction patterns that are illicit-activity indicators,
// not just profile drift. Surfaced as "fraud warnings" per the challenge brief.
export const FRAUD_CATEGORIES = new Set<SignalCategory>([
  "cross_border_anomaly", // money mule
  "structuring_pattern", // smurfing / layering
  "dormancy_break", // suspicious activation / account takeover
  "unexplained_volume_surge", // activity inconsistent with stated business
]);

export function isFraudTypology(category: SignalCategory): boolean {
  return FRAUD_CATEGORIES.has(category);
}

export function recommendedAction(category: SignalCategory): string {
  return RECOMMENDED_ACTIONS[category];
}
