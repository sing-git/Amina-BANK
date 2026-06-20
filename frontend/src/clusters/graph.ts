// Builds the radial hub-and-spoke graph model from the raw drift-signals shape
// (scrapers/news-feed/kyc_drift_signals.json). Three levels: one center anchor →
// company hubs → unique-entity leaves. Dedup rules per the spec:
//   - one leaf per unique entity (normalized name), carrying ALL its articles
//   - articles deduped by url (the source data has exact duplicates)
//   - distinct roles for the same entity are merged onto the one leaf

export type SentimentLabel = "negative" | "neutral" | "positive";

// Per-article risk-polarity sentiment (scrapers/news-feed/sentiment_enrich.py).
export interface SignalSentiment {
  label: "adverse" | "neutral" | "benign";
  risk_polarity: number; // 0..1, higher = more adverse for the company
  tone_compound: number; // raw VADER tone [-1..+1]
  drivers: string[];
  method: string;
}

// Company-level rollup (the `sentiment_score` object on each company).
export interface CompanySentiment {
  score: number; // -1 adverse .. +1 favourable
  label: SentimentLabel | "no_data";
  risk_polarity: number;
  adverse_ratio: number;
  article_count: number;
  distribution: { adverse: number; neutral: number; benign: number };
}

export interface RawArticle {
  dimension: string;
  linked_entities?: { name: string; role: string }[];
  title: string;
  url: string;
  published_at: string;
  source: string;
  summary: string;
  full_text: string;
  sentiment?: SignalSentiment;
}
export interface RawCompany {
  company_id: string;
  legal_name: string;
  articles_screened: number;
  kept_count: number;
  sentiment_score?: CompanySentiment;
  signals: RawArticle[];
}

export interface ArticleRef {
  dimension: string;
  title: string;
  url: string;
  published_at: string;
  source: string;
  summary: string;
  full_text: string;
  sentiment?: SignalSentiment;
}

export interface HubNode {
  id: string;
  kind: "hub";
  companyId: string;
  name: string;
  keptCount: number;
  articlesScreened: number;
  articles: ArticleRef[]; // all company articles, deduped by url
  dimensions: string[];
  hue: number;
  sentiment?: CompanySentiment; // company-level news sentiment rollup (heat-map fill)
  registryDrift?: { alerts: string[] }; // set when the registry report flags this company (red cluster)
}

export interface RelatedEntity {
  id: string;
  name: string;
}

// ── Sanctions screening (scrapers/sanctions/kyc_sanctions_flags.json) ──
export interface SanctionMatch {
  score: number;
  matched_name: string;
  source: string;
  list_name: string;
  programs: string[];
}
export interface SanctionFlag {
  name: string;
  kind?: string; // "KYC company" | "Linked entity"
  contexts?: { linked_to?: string; role?: string; dimension?: string; title?: string; url?: string }[];
  matches?: SanctionMatch[];
}
// The overlay attached to a graph leaf when its entity matches a screening flag.
export interface LeafSanction {
  matchedName: string;
  score: number;
  source: string;
  listName: string;
  programs: string[];
  tier: "confirmed" | "review"; // ≥ auto-block threshold → confirmed; else human-review
}

// ── Corporate registry drift (scrapers/corporate/kyc_drift_report.json) ──
export interface RegistryDriftEntry {
  company_name: string;
  status?: string; // "HEALTHY" | "DRIFT DETECTED"
  negative_alerts?: string[];
  raw_api_data?: { jurisdiction?: string; company_status?: string };
}

export type ParentKind = "hub" | "category" | "leaf";

export interface LeafNode {
  id: string;
  kind: "leaf";
  companyId: string;
  hubId: string;
  // Graph parent: a role-type category bubble by default; OR another leaf when this
  // entity's role names it (e.g. "Robert Granieri" → "Jane Street"); OR the hub.
  parentId: string;
  parentKind: ParentKind;
  category: string | null; // category key the entity's role mapped to (if any)
  name: string;
  aliases: string[]; // surface variants merged into this entity (e.g. "Boeing", "The Boeing Company")
  roles: string[];
  articles: ArticleRef[]; // articles mentioning this entity, deduped by url
  count: number;
  dimensions: string[];
  hue: number;
  related: RelatedEntity[]; // other entities named in this entity's role(s) — e.g. a person → their firm
  sentiment?: { score: number; label: SentimentLabel }; // aggregated news sentiment for this entity
  sanction?: LeafSanction; // set when this entity matches a sanctions-screening flag (contagion)
}

// A synthetic role-type bubble (Investors / Regulators / Partners …) that groups the
// named entities sharing that role, so the hub isn't swamped by individual leaves.
export interface CategoryNode {
  id: string;
  kind: "category";
  companyId: string;
  hubId: string;
  parentId: string;
  parentKind: "hub";
  key: string;
  label: string;
  count: number; // number of member entities
  hue: number;
}

export interface CenterNode {
  id: "center";
  kind: "center";
  name: string;
}

export type GraphNode = (CenterNode | HubNode | CategoryNode | LeafNode) & {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  // layout helpers
  r?: number;
  targetR?: number;
};

export interface GraphLink {
  source: string;
  target: string;
  kind: "spoke" | "category" | "leaf";
  companyId: string;
}

// Intra-cluster relation: a leaf whose role names another leaf (person → firm, etc.).
export interface RelationLink {
  source: string;
  target: string;
  companyId: string;
}

export interface Graph {
  center: CenterNode;
  hubs: HubNode[];
  categories: CategoryNode[];
  leaves: LeafNode[];
  links: GraphLink[];
  relations: RelationLink[];
  dimensions: string[];
}

// Distinct hues (degrees) — one per company cluster. Hub = saturated/dark of the
// hue; leaves = desaturated/light tints of the SAME hue (computed in the view).
const HUES = [8, 28, 45, 95, 145, 175, 200, 225, 265, 320, 340, 15];

// Role-type taxonomy: an entity's role text maps to a category bubble. First match
// wins (most specific first), so "investee" beats "investor", etc.
interface CategoryDef {
  key: string;
  label: string;
  test: RegExp;
}
// Order also breaks ties: regulators win over "investor" when both appear (the
// regulatory phrase "Investor Alert List" is a false friend, handled below too).
const CATEGORIES: CategoryDef[] = [
  { key: "investee", label: "Investees", test: /investee|portfolio compan/i },
  {
    key: "regulator",
    label: "Regulators",
    test: /regulat|authorit|monetar|autoridad|commission|watchdog|central bank|ministry|licens|supervis|\bsec\b|prosecutor|\bcma\b|\bmas\b/i,
  },
  {
    key: "investor",
    label: "Investors",
    test: /invest(?:or|ors|ing|ment|ments|ed|s)?\b|\bstakes?\b|\bholdings?\b|shareholder|backer|venture capital|\bvc\b|capital raise|funding round|financ(?:ier|ing)/i,
  },
  { key: "partner", label: "Partners", test: /partner|collaborat|alliance|joint venture/i },
  { key: "competitor", label: "Competitors", test: /competitor|rival/i },
  { key: "deal", label: "M&A / Deals", test: /acqui|merger|takeover|buyout|\bbuyer\b|\bsuitor\b/i },
  {
    key: "legal",
    label: "Legal / Adverse",
    test: /accus|lawsuit|sued|defendant|plaintiff|litigat|alleg|fraud|charged|claimant|liquidator|administrator/i,
  },
  {
    key: "people",
    label: "People",
    test: /\bceo\b|\bcfo\b|\bcto\b|chief|founder|president|\bdirector|executive|chairman|trader|employee|officer|head of|analyst|spokes|manager|\bvp\b/i,
  },
  { key: "subsidiary", label: "Subsidiaries", test: /subsidiar|\bunit\b|division|owned by/i },
  { key: "supplier", label: "Suppliers / Vendors", test: /supplier|vendor|provider|contractor|manufactur/i },
  { key: "customer", label: "Customers", test: /customer|\bclient\b|\buser\b/i },
  { key: "media", label: "Media", test: /report|news|journalist|\bpress\b|magazine|coverage|outlet/i },
];

// Pick a category from an entity's NAME + ROLE. A name hit weighs more than a role hit
// (a body literally called "Monetary Authority" is a regulator regardless of role text).
// Highest score wins; CATEGORIES order breaks ties.
function categoryOf(name: string, roleText: string): CategoryDef | null {
  const n = ` ${name.toLowerCase()} `;
  // "Investor Alert List" is a regulator's tool, not an investment role — neutralize it.
  const role = ` ${roleText.toLowerCase()} `.replace(/investor alert/g, "regulatory alert");
  let best: CategoryDef | null = null;
  let bestScore = 0;
  for (const c of CATEGORIES) {
    const score = (c.test.test(n) ? 2 : 0) + (c.test.test(role) ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

export function categoryLabel(key: string): string {
  return CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

// Corporate suffixes / forms stripped when collapsing variants so "Boeing",
// "Boeing Inc" and "The Boeing Company" map to the same entity.
const CORP_SUFFIXES = new Set([
  "inc", "incorporated", "corp", "corporation", "company", "co", "holdings", "holding",
  "group", "ltd", "limited", "llc", "lp", "llp", "plc", "ag", "sa", "se", "nv", "bv",
  "gmbh", "spa", "oyj", "ab", "as", "kk", "pte", "pty", "fintech", "labs", "lab",
  "technologies", "solutions", "ventures", "capital", "partners", "trust", "bank",
]);

// Canonical key for dedup: lowercase, drop "the"/possessives/punctuation, collapse
// "&", strip trailing corporate suffixes (repeatedly: "credit suisse group ag" → "credit suisse").
function canonicalKey(name: string): string {
  let s = name.toLowerCase().trim();
  s = s.replace(/\([^)]*\)/g, " "); // drop parentheticals: "Central Bank … (CBUAE)" → "Central Bank …"
  s = s.replace(/\.com\b/g, "");
  s = s.replace(/&/g, " and ");
  s = s.replace(/['’]s\b/g, "");
  s = s.replace(/[.,()'’"/]/g, " ");
  let tokens = s.split(/\s+/).filter(Boolean).filter((t) => t !== "the");
  while (tokens.length > 1 && CORP_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ").trim();
}

// Among the merged surface forms, pick the one seen most often (tie-break: longest).
function pickDisplay(variants: Map<string, number>): string {
  let best = "";
  let bestVotes = -1;
  for (const [name, votes] of variants) {
    if (votes > bestVotes || (votes === bestVotes && name.length > best.length)) {
      best = name;
      bestVotes = votes;
    }
  }
  return best;
}

// Does `roleText` name the entity `core` (its canonical key) as a whole word/phrase?
function roleMentions(roleText: string, core: string): boolean {
  if (core.length < 4) return false; // skip tiny/ambiguous cores
  const esc = core.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i").test(roleText);
}

function toArticle(s: RawArticle): ArticleRef {
  return {
    dimension: s.dimension,
    title: s.title,
    url: s.url,
    published_at: s.published_at,
    source: s.source,
    summary: s.summary,
    full_text: s.full_text,
    sentiment: s.sentiment,
  };
}

function byDateDesc(a: ArticleRef, b: ArticleRef) {
  return (b.published_at || "").localeCompare(a.published_at || "");
}

// Aggregate a set of articles into one signed sentiment score in [-1, +1]:
// negative = adverse coverage, positive = favourable. Each article contributes
// `tone_compound - risk_polarity` (clamped), mirroring the company-level rollup
// in scrapers/news-feed/sentiment_enrich.py so leaves and hubs agree.
export function aggregateSentiment(
  articles: ArticleRef[],
): { score: number; label: SentimentLabel } | undefined {
  const vals = articles.map((a) => a.sentiment).filter((s): s is SignalSentiment => !!s);
  if (!vals.length) return undefined;
  const signed = vals.map((s) => Math.max(-1, Math.min(1, s.tone_compound - s.risk_polarity)));
  const score = signed.reduce((a, b) => a + b, 0) / signed.length;
  const label: SentimentLabel = score >= 0.25 ? "positive" : score <= -0.25 ? "negative" : "neutral";
  return { score, label };
}

// Score at/above this auto-block threshold is a high-confidence match; below it is a
// review-tier (likely-homonym) candidate. Mirrors backend POLICY.sanctions.autoThreshold.
const SANCTIONS_AUTO_THRESHOLD = 98;

export function buildGraph(
  companies: RawCompany[],
  flags: SanctionFlag[] = [],
  registry: RegistryDriftEntry[] = [],
): Graph {
  const hubs: HubNode[] = [];
  const categories: CategoryNode[] = [];
  const leaves: LeafNode[] = [];
  const links: GraphLink[] = [];
  const relations: RelationLink[] = [];
  const allDimensions = new Set<string>();

  companies.forEach((co, ci) => {
    const hue = HUES[ci % HUES.length];
    const hubId = co.company_id;
    const hubCanon = canonicalKey(co.legal_name); // for self-entity merge (Revolut fix)

    // Company-level articles, deduped by url.
    const companyArticles = new Map<string, ArticleRef>();
    // Entity leaves keyed by CANONICAL name (fuzzy dedup of corporate variants).
    const entityMap = new Map<
      string,
      { variants: Map<string, number>; roles: Set<string>; articles: Map<string, ArticleRef> }
    >();

    for (const s of co.signals ?? []) {
      const art = toArticle(s);
      const urlKey = art.url || `${art.title}::${art.published_at}`;
      if (!companyArticles.has(urlKey)) companyArticles.set(urlKey, art);
      allDimensions.add(art.dimension);

      for (const le of s.linked_entities ?? []) {
        if (!le?.name) continue;
        const key = canonicalKey(le.name);
        if (!key) continue;
        if (key === hubCanon) continue; // entity IS the company → it's the hub, not a leaf
        let e = entityMap.get(key);
        if (!e) {
          e = { variants: new Map(), roles: new Set(), articles: new Map() };
          entityMap.set(key, e);
        }
        const surface = le.name.trim();
        e.variants.set(surface, (e.variants.get(surface) ?? 0) + 1);
        if (le.role) e.roles.add(le.role.trim());
        if (!e.articles.has(urlKey)) e.articles.set(urlKey, art);
      }
    }

    const hubArticles = [...companyArticles.values()].sort(byDateDesc);
    const hubDims = [...new Set(hubArticles.map((a) => a.dimension))];
    hubs.push({
      id: hubId,
      kind: "hub",
      companyId: co.company_id,
      name: co.legal_name,
      keptCount: co.kept_count ?? hubArticles.length,
      articlesScreened: co.articles_screened ?? 0,
      articles: hubArticles,
      dimensions: hubDims,
      hue,
      sentiment: co.sentiment_score,
    });
    links.push({ source: "center", target: hubId, kind: "spoke", companyId: co.company_id });

    // Build this company's leaves; tag each with the category its role maps to.
    const companyLeaves: LeafNode[] = [...entityMap.entries()].map(([key, e]) => {
      const arts = [...e.articles.values()].sort(byDateDesc);
      const roleList = [...e.roles];
      const name = pickDisplay(e.variants);
      const cat = categoryOf(name, roleList.join(" | "));
      return {
        id: `${hubId}::${key}`,
        kind: "leaf",
        companyId: co.company_id,
        hubId,
        parentId: hubId,
        parentKind: "hub",
        category: cat?.key ?? null,
        name,
        aliases: [...e.variants.keys()],
        roles: roleList,
        articles: arts,
        count: arts.length,
        dimensions: [...new Set(arts.map((a) => a.dimension))],
        hue,
        related: [],
        sentiment: aggregateSentiment(arts),
      };
    });
    const leafById = new Map(companyLeaves.map((l) => [l.id, l]));

    // Role-based relations: a leaf whose role names another leaf (person → firm, etc.).
    const cores = companyLeaves.map((l) => canonicalKey(l.name));
    for (const leaf of companyLeaves) {
      const roleText = leaf.roles.join(" | ").toLowerCase();
      if (!roleText) continue;
      companyLeaves.forEach((other, j) => {
        if (other.id === leaf.id) return;
        if (leaf.related.some((r) => r.id === other.id)) return;
        if (roleMentions(roleText, cores[j])) {
          leaf.related.push({ id: other.id, name: other.name });
          relations.push({ source: leaf.id, target: other.id, companyId: co.company_id });
        }
      });
    }

    // Priority-1: a leaf that names a strictly-bigger entity hangs off THAT entity
    // (e.g. "Robert Granieri" → "Jane Street"). Those firms stay on the hub as sub-hubs.
    const firmParent = new Map<string, LeafNode>();
    for (const leaf of companyLeaves) {
      let best: LeafNode | null = null;
      for (const r of leaf.related) {
        const t = leafById.get(r.id);
        if (!t) continue;
        if (t.count > leaf.count && (!best || t.count > best.count)) best = t;
      }
      if (best) firmParent.set(leaf.id, best);
    }
    const linkTargets = new Set([...firmParent.values()].map((f) => f.id));

    // Priority-2: group the rest by role-type category (bubble created only when ≥2
    // members share it — singletons stay on the hub to avoid trivial bubbles).
    const catMembers = new Map<string, LeafNode[]>();
    for (const leaf of companyLeaves) {
      if (linkTargets.has(leaf.id)) continue; // a firm sub-hub → stays on hub
      if (firmParent.has(leaf.id)) {
        const f = firmParent.get(leaf.id)!;
        leaf.parentId = f.id;
        leaf.parentKind = "leaf";
        continue;
      }
      if (leaf.category) {
        let arr = catMembers.get(leaf.category);
        if (!arr) catMembers.set(leaf.category, (arr = []));
        arr.push(leaf);
      }
      // else: parent stays the hub (default)
    }

    for (const [key, members] of catMembers) {
      if (members.length < 2) continue; // singleton → leave on hub
      const bubbleId = `${hubId}::cat::${key}`;
      categories.push({
        id: bubbleId,
        kind: "category",
        companyId: co.company_id,
        hubId,
        parentId: hubId,
        parentKind: "hub",
        key,
        label: categoryLabel(key),
        count: members.length,
        hue,
      });
      links.push({ source: hubId, target: bubbleId, kind: "category", companyId: co.company_id });
      for (const m of members) {
        m.parentId = bubbleId;
        m.parentKind = "category";
      }
    }

    for (const l of companyLeaves) {
      leaves.push(l);
      links.push({ source: l.parentId, target: l.id, kind: "leaf", companyId: co.company_id });
    }
  });

  // ── Sanctions contagion overlay: tag any leaf whose entity matches a screening flag ──
  const flagByKey = new Map<string, LeafSanction>();
  for (const f of flags) {
    const best = (f.matches ?? []).slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    if (!best) continue;
    const key = canonicalKey(f.name);
    if (!key) continue;
    flagByKey.set(key, {
      matchedName: best.matched_name,
      score: best.score,
      source: best.source,
      listName: best.list_name,
      programs: best.programs ?? [],
      tier: best.score >= SANCTIONS_AUTO_THRESHOLD ? "confirmed" : "review",
    });
  }
  if (flagByKey.size) {
    for (const l of leaves) {
      for (const variant of [l.name, ...l.aliases]) {
        const hit = flagByKey.get(canonicalKey(variant));
        if (hit) {
          l.sanction = hit;
          break;
        }
      }
    }
  }

  // ── Registry drift overlay: tag hubs whose registry status is DRIFT DETECTED (red cluster).
  //    HEALTHY companies are left untouched (nothing shown).
  const driftByKey = new Map<string, string[]>();
  for (const r of registry) {
    const detected = (r.status ?? "").toUpperCase().includes("DRIFT") || (r.negative_alerts?.length ?? 0) > 0;
    if (!detected) continue;
    const key = canonicalKey(r.company_name);
    if (key) driftByKey.set(key, r.negative_alerts ?? []);
  }
  if (driftByKey.size) {
    for (const h of hubs) {
      const alerts = driftByKey.get(canonicalKey(h.name));
      if (alerts) h.registryDrift = { alerts };
    }
  }

  return {
    center: { id: "center", kind: "center", name: "Watchlist" },
    hubs,
    categories,
    leaves,
    links,
    relations,
    dimensions: [...allDimensions].sort(),
  };
}

// Human-readable dimension label, e.g. "adverse_media_legal" → "Adverse media / legal".
export function dimensionLabel(d: string): string {
  const map: Record<string, string> = {
    adverse_media_legal: "Adverse media / legal",
    sanctions_regulatory: "Sanctions / regulatory",
    ownership_change: "Ownership change",
    key_personnel_change: "Key personnel change",
    business_model_change: "Business-model change",
    activity_volume_change: "Activity / volume change",
    jurisdiction_structure_change: "Jurisdiction / structure change",
  };
  return map[d] ?? d.replace(/_/g, " ");
}

// A fixed, hue-distinct tag color for a dimension (kept calm to match the paper look).
const DIM_HUE: Record<string, number> = {
  adverse_media_legal: 354,
  sanctions_regulatory: 12,
  ownership_change: 265,
  key_personnel_change: 200,
  business_model_change: 150,
  activity_volume_change: 38,
  jurisdiction_structure_change: 320,
};
export function dimensionHue(d: string): number {
  return DIM_HUE[d] ?? 220;
}
