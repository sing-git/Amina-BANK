// Adapter: Kiara's sanctions matches (data/sanctions_hits.json) → a name lookup the
// hard gate consults. The Python bridge (scrapers/sanctions/screen_portfolio.py) screens
// every portfolio company against OFAC/UN and writes that file.
//
// Contract (data/sanctions_hits.json):
//   [ { "client_id", "query", "matched": true, "matched_entity", "score", "source", "programs": [] } ]
import { existsSync, readFileSync } from "node:fs";

export interface SanctionsHit {
  query: string;
  matchedEntity: string;
  score: number;
  source: string;
  programs?: string[];
  jurisdiction?: string; // secondary identifier for homonym disambiguation (if available)
}

/** Normalize a name to a comparison key (lowercase alphanumerics only). */
export function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const DEFAULT_PATH = new URL("../../../data/sanctions_hits.json", import.meta.url);

/** Load real sanctions hits keyed by normalized name. Empty if the file isn't generated. */
export function loadSanctionsHits(path: URL | string = DEFAULT_PATH): Map<string, SanctionsHit> {
  const map = new Map<string, SanctionsHit>();
  if (!existsSync(path)) return map;
  const arr = JSON.parse(readFileSync(path, "utf8")) as Array<{
    query: string;
    matched?: boolean;
    matched_entity?: string;
    score?: number;
    source?: string;
    programs?: string[];
    jurisdiction?: string;
  }>;
  for (const h of arr) {
    if (h.matched === false) continue;
    map.set(normName(h.query), {
      query: h.query,
      matchedEntity: h.matched_entity ?? h.query,
      score: h.score ?? 100,
      source: h.source ?? "sanctions",
      programs: h.programs,
      jurisdiction: h.jurisdiction,
    });
  }
  return map;
}
