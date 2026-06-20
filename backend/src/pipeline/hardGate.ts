// Hard gate — sanctions/PEP. Binary, deterministic, EXACT match only.
// A match short-circuits the whole pipeline to CRITICAL. See spec section 3.2.
//
// For the demo this checks against a local sanctions stub. In production the
// `querySanctions` function is swapped for a call to the connected sanctions MCP
// (OpenSanctions / OFAC). The exact-match contract stays the same either way.

import type { ClientBaseline } from "../types.js";
import { loadSanctionsHits, normName } from "../ingest/sanctionsAdapter.js";

export interface HardGateResult {
  matched: boolean;
  matchedEntity?: string;
  sourceUrl?: string;
}

// Real OFAC/UN hits produced by Kiara's bridge (scrapers/sanctions/screen_portfolio.py).
// Empty until that file exists; then it takes priority over the demo stub.
const REAL_HITS = loadSanctionsHits();

// Demo stub list (for the bundled demo cases not present on real lists).
const DEMO_SANCTIONS = new Set(
  ["blocked holdings ltd", "ivan petrov", "north star trading fze"].map((s) => s.toLowerCase().trim()),
);

async function querySanctions(name: string): Promise<{ hit: boolean; entity?: string; sourceUrl?: string }> {
  // 1) real sanctions data (Kiara) first
  const real = REAL_HITS.get(normName(name));
  if (real) {
    return { hit: true, entity: real.matchedEntity, sourceUrl: `sanctions:${real.source}` };
  }
  // 2) demo fallback
  const hit = DEMO_SANCTIONS.has(name.toLowerCase().trim());
  return { hit, entity: hit ? name : undefined, sourceUrl: hit ? "https://www.opensanctions.org" : undefined };
}

export async function checkSanctionsPEP(
  legalName: string,
  ubos: ClientBaseline["ubos"],
): Promise<HardGateResult> {
  // entity itself
  const entity = await querySanctions(legalName);
  if (entity.hit) {
    return { matched: true, matchedEntity: entity.entity ?? legalName, sourceUrl: entity.sourceUrl };
  }

  // each UBO (and any PEP UBO is an automatic gate)
  for (const ubo of ubos) {
    if (ubo.isPEP) {
      return {
        matched: true,
        matchedEntity: `${ubo.name} (PEP)`,
        sourceUrl: "internal:kyc:pep-flag",
      };
    }
    const hit = await querySanctions(ubo.name);
    if (hit.hit) return { matched: true, matchedEntity: hit.entity ?? ubo.name, sourceUrl: hit.sourceUrl };
  }

  return { matched: false };
}
