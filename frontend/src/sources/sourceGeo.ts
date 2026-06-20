// Turns the three source feeds (news / sanctions / corporate) into world-map points.
// Geographic origin is INFERRED:
//   - news    → article URL domain (ccTLD; generic gTLDs default to US, the dominant origin)
//   - sanctions → the issuing body of the best match (OFAC → US, OpenSanctions → DE)
//   - registry  → raw_api_data.jurisdiction (which registry API served the record)
import type { RawCompany, SanctionFlag, RegistryDriftEntry } from "../clusters/graph";
import type { MapPoint } from "./WorldMap";

export type SourceCategory = "news" | "sanctions" | "registry";
export interface CategoryCounts {
  news: number;
  sanctions: number;
  registry: number;
}

// Representative [lng, lat] per ISO-3166 alpha-2 (capital / centroid) for every country we can emit.
const COUNTRY: Record<string, { name: string; coords: [number, number] }> = {
  US: { name: "United States", coords: [-98.5, 39.8] },
  GB: { name: "United Kingdom", coords: [-1.5, 52.5] },
  DE: { name: "Germany", coords: [10.4, 51.1] },
  CH: { name: "Switzerland", coords: [8.2, 46.8] },
  SG: { name: "Singapore", coords: [103.8, 1.35] },
  IE: { name: "Ireland", coords: [-8.0, 53.3] },
  AU: { name: "Australia", coords: [134.5, -25.3] },
  ES: { name: "Spain", coords: [-3.7, 40.4] },
  FR: { name: "France", coords: [2.3, 46.6] },
  CA: { name: "Canada", coords: [-106.3, 56.1] },
  NZ: { name: "New Zealand", coords: [174.0, -41.0] },
  IN: { name: "India", coords: [78.9, 22.0] },
  HK: { name: "Hong Kong", coords: [114.1, 22.3] },
  AE: { name: "United Arab Emirates", coords: [54.0, 24.0] },
  ZA: { name: "South Africa", coords: [24.0, -29.0] },
};

// ccTLD → ISO country (handles .com.sg / .co.uk via the final label).
const CCTLD: Record<string, string> = {
  de: "DE", sg: "SG", ie: "IE", au: "AU", es: "ES", uk: "GB", ch: "CH",
  ca: "CA", nz: "NZ", in: "IN", hk: "HK", ae: "AE", fr: "FR", za: "ZA",
};

// Outlets whose generic gTLD doesn't reflect their home country.
const DOMAIN_OVERRIDE: Record<string, string> = {
  "irishtimes.com": "IE",
  "diariobitcoin.com": "ES",
  "agbi.com": "AE",
  "biznews.com": "ZA",
  "proactiveinvestors.com": "GB",
};

// Sanctions issuing body → ISO of the issuing authority.
const SANCTIONS_SOURCE: Record<string, string> = {
  ofac: "US",
  opensanctions: "DE",
  un: "US",
  eu: "DE",
};

// Registry jurisdiction string → ISO.
const JURISDICTION: Record<string, string> = {
  us: "US", usa: "US", "united states": "US",
  uk: "GB", "united kingdom": "GB", gb: "GB",
  singapore: "SG", sg: "SG",
  switzerland: "CH", ch: "CH",
  germany: "DE",
};

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Infer the ISO country for a news article URL. Generic gTLDs default to US. */
export function countryForDomain(url: string): string {
  const host = hostOf(url);
  if (!host) return "US";
  if (DOMAIN_OVERRIDE[host]) return DOMAIN_OVERRIDE[host];
  const tld = host.split(".").pop() ?? "";
  return CCTLD[tld] ?? "US";
}

/** Aggregate all three feeds into per-country map points + source-type totals. */
export function buildSourceMap(
  companies: RawCompany[],
  flags: SanctionFlag[],
  registry: RegistryDriftEntry[],
): { points: MapPoint[]; regions: { label: string; count: number }[] } {
  const acc = new Map<string, CategoryCounts>();
  const bump = (iso: string, cat: SourceCategory) => {
    const e = acc.get(iso) ?? { news: 0, sanctions: 0, registry: 0 };
    e[cat] += 1;
    acc.set(iso, e);
  };

  for (const co of companies ?? []) {
    for (const s of co.signals ?? []) {
      if (s.url) bump(countryForDomain(s.url), "news");
    }
  }
  for (const f of flags ?? []) {
    for (const m of f.matches ?? []) {
      bump(SANCTIONS_SOURCE[(m.source ?? "").toLowerCase()] ?? "US", "sanctions");
    }
  }
  for (const r of registry ?? []) {
    bump(JURISDICTION[(r.raw_api_data?.jurisdiction ?? "").toLowerCase()] ?? "US", "registry");
  }

  const points: MapPoint[] = [];
  for (const [iso, c] of acc) {
    const meta = COUNTRY[iso];
    if (!meta) continue; // unknown ISO → skip rather than mis-place
    const total = c.news + c.sanctions + c.registry;
    const rows: string[] = [];
    if (c.news) rows.push(`${c.news} news source${c.news > 1 ? "s" : ""}`);
    if (c.sanctions) rows.push(`${c.sanctions} sanctions record${c.sanctions > 1 ? "s" : ""}`);
    if (c.registry) rows.push(`${c.registry} registry record${c.registry > 1 ? "s" : ""}`);
    points.push({ id: iso, name: meta.name, coordinates: meta.coords, count: total, byCategory: c, rows });
  }
  points.sort((a, b) => b.count - a.count);

  const sum = (cat: SourceCategory) => points.reduce((s, p) => s + (p.byCategory?.[cat] ?? 0), 0);
  const regions = [
    { label: "News feeds", count: sum("news") },
    { label: "Sanctions lists", count: sum("sanctions") },
    { label: "Corporate registries", count: sum("registry") },
  ];
  return { points, regions };
}

// Map a source-type filter label → the category key on a point.
export const REGION_CATEGORY: Record<string, SourceCategory> = {
  "News feeds": "news",
  "Sanctions lists": "sanctions",
  "Corporate registries": "registry",
};
