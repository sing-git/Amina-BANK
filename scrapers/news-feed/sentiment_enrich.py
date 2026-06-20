#!/usr/bin/env python3
"""Enrich kyc_drift_signals.json with a per-signal `sentiment` object.

Standalone post-processing step (run after signal_extractor.py). For each news
signal it computes a *risk-polarity* sentiment from the bank's point of view:
how adverse the article is for the company, not generic article tone.

Method: VADER (vaderSentiment) for tone, with its lexicon extended by the
finance-risk terms already curated in stage_scorer.py's RISK_LEXICON, then
oriented so that negative tone -> high risk. A separate phrase pass over the
same finance-risk terms produces the matched `drivers` and a density boost.

The added field per signal:

    "sentiment": {
        "label":         "adverse" | "neutral" | "benign",
        "risk_polarity": 0.0,        # 0..1, higher = more adverse for the bank
        "tone_compound": -0.42,      # raw VADER compound [-1..+1], transparency
        "drivers":       ["dissolved", "collapse"],   # matched finance-risk terms
        "method":        "vader+finance-lexicon"
    }

It also adds a company-level rollup right after `kept_count`:

    "sentiment_score": {
        "score":         -0.34,      # -1 adverse .. +1 favourable (overall coverage)
        "label":         "negative", # negative | neutral | positive
        "risk_polarity": 0.41,       # 0..1 mean adversity (bank's view)
        "adverse_ratio": 0.875,      # share of articles flagged adverse
        "article_count": 8,
        "distribution":  {"adverse": 7, "neutral": 1, "benign": 0}
    }

Re-running overwrites any existing `sentiment` / `sentiment_score` fields (idempotent).
"""

import argparse
import json
import re
import sys
from pathlib import Path

try:
    from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
except ImportError:
    sys.exit(
        "vaderSentiment is not installed. Run: pip install vaderSentiment\n"
        "(it is listed in requirements.txt)"
    )

HERE = Path(__file__).resolve().parent
DEFAULT_INPUT = HERE / "kyc_drift_signals.json"
FRONTEND_COPY = HERE.parent.parent / "frontend" / "src" / "data" / "kyc_drift_signals.json"

BODY_CHARS = 3000  # headlines/leads carry the signal; cap long bodies for speed

# ---------------------------------------------------------------------------
# Finance-risk terms, grouped by severity (5 = hardest flag).
# Seeded from stage_scorer.py's RISK_LEXICON (the source of truth) — kept here
# to avoid importing that module (it pulls in rapidfuzz / sentence-transformers).
# If these ever need to stay perfectly in sync, factor RISK_LEXICON into a small
# shared module and import it from both places.
# ---------------------------------------------------------------------------
RISK_TERMS = {
    5: [  # Tier 1 hard flags: sanctions / terrorism / criminal charges
        "sanctions", "sanctioned", "ofac", "sdn list", "blacklisted", "watchlist",
        "asset freeze", "assets frozen", "funds frozen", "arms embargo",
        "sanctions evasion", "sanctions circumvention", "front company",
        "terrorism", "terrorist financing", "financing terrorism",
        "proliferation financing", "money laundering", "aml violation",
        "arrested", "indicted", "indictment", "charged", "criminal charges",
        "convicted", "conviction", "guilty plea", "sentenced", "fraud",
        "wire fraud", "bank fraud", "tax evasion", "bribery", "corruption",
        "embezzlement", "market manipulation", "insider trading", "ponzi scheme",
        "securities fraud", "accounting fraud", "drug trafficking",
        "human trafficking", "interpol red notice",
    ],
    4: [  # Tier 2 high-risk structural: dissolution / adverse regulatory
        "dissolved", "dissolution", "struck off", "deregistered",
        "wound up", "winding up", "liquidated", "liquidation",
        "in administration", "receivership", "bankrupt", "bankruptcy",
        "chapter 11", "chapter 7", "insolvent", "insolvency",
        "ceased operations", "operations suspended", "exit scam", "rug pull",
        "regulatory investigation", "regulatory probe", "under investigation",
        "enforcement action", "cease and desist", "license revoked",
        "licence revoked", "license suspended", "licence suspended",
        "authorisation withdrawn", "fined", "fine imposed", "civil penalty",
        "financial penalty", "record fine", "sec charges", "doj",
        "fca fine", "compliance failure", "kyc failure", "aml failure",
        "suspicious activity report",
    ],
    3: [  # Tier 3 medium structural: leadership / ownership / jurisdiction / cyber
        "ceo resign", "ceo resignation", "ceo steps down", "ceo fired",
        "ceo ousted", "ceo removed", "ceo arrested", "ceo charged",
        "ceo investigated", "ceo suspended", "mass resignation",
        "executive exodus", "boardroom battle", "management crisis",
        "hostile takeover", "change of control", "nominee director",
        "nominee shareholder", "hidden ownership", "opaque ownership",
        "bearer shares", "undisclosed ownership",
        "tax haven", "offshore structure", "shell company", "shelf company",
        "letterbox company", "panama papers", "pandora papers",
        "data breach", "security breach", "hacked", "cyberattack", "ransomware",
        "exchange hack", "crypto theft", "smart contract exploit", "defi exploit",
        "private key stolen", "lazarus group",
    ],
    2: [  # Tier 5 adverse media + general negative sentiment
        "scandal", "controversy", "misconduct", "whistleblower", "cover-up",
        "lawsuit", "class action", "legal action", "litigation", "sued",
        "investigation", "expose", "leaked documents",
        "reputational damage", "public backlash", "public outcry",
        "collapse", "collapsed", "crisis", "failure", "default", "defaulted",
        "margin call", "liquidity crisis", "liquidity crunch", "cash burn",
        "profit warning", "revenue warning", "downgrade", "credit downgrade",
        "writedown", "write-off", "impairment", "record loss",
        "share price crash", "stock crash", "sell-off", "bank run",
        "trading suspended", "trading halt", "mass layoffs", "major job cuts",
    ],
}

# A few finance-positive terms so clearly upbeat coverage can be flagged benign.
POSITIVE_TERMS = [
    "record profit", "profits surge", "strong earnings", "beats expectations",
    "raised guidance", "rating upgrade", "credit upgrade", "dividend increase",
    "milestone", "awarded",
]


def build_analyzer():
    """VADER with single-word finance terms boosted into its lexicon."""
    analyzer = SentimentIntensityAnalyzer()
    # VADER only scores single tokens, so multi-word phrases (handled in the
    # phrase pass below) are skipped here; single words get a severity-scaled
    # negative valence (~ -2.5 for severity 1 ... -4.2 for severity 5).
    for severity, terms in RISK_TERMS.items():
        valence = -(2.0 + 0.45 * severity)
        for term in terms:
            if " " not in term:
                analyzer.lexicon[term] = valence
    for term in POSITIVE_TERMS:
        if " " not in term:
            analyzer.lexicon[term] = 2.5
    return analyzer


# Precompiled word-boundary matchers per term, paired with their severity.
def _compile_terms():
    compiled = []
    for severity, terms in RISK_TERMS.items():
        for term in terms:
            pattern = re.compile(r"\b" + re.escape(term) + r"\b")
            compiled.append((severity, term, pattern))
    return compiled


TERM_MATCHERS = _compile_terms()


def combined_compound(analyzer, title, summary, body):
    """Weighted VADER compound favouring title/summary over body."""
    fields = [
        (title, 0.40),
        (summary, 0.35),
        (body[:BODY_CHARS], 0.25),
    ]
    total_weight = 0.0
    acc = 0.0
    for text, weight in fields:
        text = (text or "").strip()
        if not text:
            continue
        acc += analyzer.polarity_scores(text)["compound"] * weight
        total_weight += weight
    if total_weight == 0.0:
        return 0.0
    return acc / total_weight


def matched_drivers(text_lower):
    """Distinct finance-risk terms present in the text, with their severities."""
    hits = {}
    for severity, term, pattern in TERM_MATCHERS:
        if pattern.search(text_lower):
            hits[term] = max(severity, hits.get(term, 0))
    return hits


def score_signal(analyzer, signal):
    title = signal.get("title", "") or ""
    summary = signal.get("summary", "") or ""
    body = signal.get("full_text", "") or ""

    tone = combined_compound(analyzer, title, summary, body)

    text_lower = f"{title}\n{summary}\n{body[:BODY_CHARS]}".lower()
    hits = matched_drivers(text_lower)

    # density_boost: harder flags push risk up more; capped so tone still matters.
    density_boost = min(0.35, sum(0.03 + 0.012 * sev for sev in hits.values()))
    risk_polarity = min(1.0, max(0.0, -tone) + density_boost)

    if risk_polarity >= 0.5:
        label = "adverse"
    elif tone >= 0.3 and not hits:
        label = "benign"
    else:
        label = "neutral"

    # Surface the most severe drivers first; deterministic for stable diffs.
    drivers = [term for term, _ in sorted(hits.items(), key=lambda kv: (-kv[1], kv[0]))][:6]

    return {
        "label": label,
        "risk_polarity": round(risk_polarity, 3),
        "tone_compound": round(tone, 3),
        "drivers": drivers,
        "method": "vader+finance-lexicon",
    }


def score_company(signals):
    """Aggregate per-article sentiment into one company-level score.

    `score` is a signed overall polarity in [-1, +1]: negative = the coverage is
    adverse for the company, positive = favourable. Each article contributes
    `tone_compound - risk_polarity` (clamped), so a factual-but-damaging article
    still pulls the company negative even when its tone reads neutral.
    """
    counts = {"adverse": 0, "neutral": 0, "benign": 0}
    signed = []
    risks = []
    for s in signals:
        se = s.get("sentiment")
        if not se:
            continue
        counts[se["label"]] = counts.get(se["label"], 0) + 1
        signed.append(max(-1.0, min(1.0, se["tone_compound"] - se["risk_polarity"])))
        risks.append(se["risk_polarity"])

    n = len(signed)
    if n == 0:
        return {"score": 0.0, "label": "no_data", "risk_polarity": 0.0,
                "adverse_ratio": 0.0, "article_count": 0, "distribution": counts}

    score = round(sum(signed) / n, 3)
    if score >= 0.25:
        label = "positive"
    elif score <= -0.25:
        label = "negative"
    else:
        label = "neutral"

    return {
        "score": score,                                  # -1 adverse .. +1 favourable
        "label": label,                                  # negative | neutral | positive
        "risk_polarity": round(sum(risks) / n, 3),       # 0..1 mean adversity (bank's view)
        "adverse_ratio": round(counts["adverse"] / n, 3),
        "article_count": n,
        "distribution": counts,
    }


def reorder_company(company, sentiment_score):
    """Return company dict with `sentiment_score` placed right after kept_count."""
    ordered = {}
    for key in ("company_id", "legal_name", "articles_screened", "kept_count"):
        if key in company:
            ordered[key] = company[key]
    ordered["sentiment_score"] = sentiment_score
    for key, value in company.items():
        if key not in ordered:
            ordered[key] = value
    return ordered


def enrich_file(path, out_path, analyzer):
    data = json.loads(path.read_text())
    n_signals = 0
    out = []
    for company in data:
        signals = company.get("signals", [])
        for signal in signals:
            signal["sentiment"] = score_signal(analyzer, signal)
            n_signals += 1
        out.append(reorder_company(company, score_company(signals)))
    out_path.write_text(json.dumps(out, indent=4, ensure_ascii=False) + "\n")
    return out, n_signals


def print_summary(data):
    counts = {"adverse": 0, "neutral": 0, "benign": 0}
    ranked = []
    print("\nCompany sentiment_score (score: -1 adverse .. +1 favourable):")
    for company in data:
        cs = company.get("sentiment_score", {})
        print(f"  {company['legal_name'][:32]:32} score={cs.get('score', 0):+.3f}  "
              f"{cs.get('label', '?'):8} "
              f"adverse={cs.get('distribution', {}).get('adverse', 0)}/{cs.get('article_count', 0)}")
        for s in company.get("signals", []):
            sent = s["sentiment"]
            counts[sent["label"]] = counts.get(sent["label"], 0) + 1
            ranked.append((sent["risk_polarity"], company["legal_name"], s.get("title", "")))
    total = sum(counts.values())
    print(f"\nScored {total} signals: "
          f"{counts['adverse']} adverse / {counts['neutral']} neutral / {counts['benign']} benign")
    ranked.sort(reverse=True)
    print("\nTop 5 most-adverse articles:")
    for polarity, company, title in ranked[:5]:
        print(f"  {polarity:.3f}  [{company}] {title[:70]}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT,
                        help=f"signals JSON to enrich (default: {DEFAULT_INPUT})")
    parser.add_argument("--out", type=Path, default=None,
                        help="output path (default: overwrite input in place)")
    parser.add_argument("--also-frontend", action="store_true",
                        help=f"also enrich the bundled copy at {FRONTEND_COPY}")
    args = parser.parse_args()

    analyzer = build_analyzer()

    out_path = args.out or args.input
    data, n = enrich_file(args.input, out_path, analyzer)
    print(f"Enriched {n} signals -> {out_path}")
    print_summary(data)

    if args.also_frontend and FRONTEND_COPY.exists():
        fe_data, fe_n = enrich_file(FRONTEND_COPY, FRONTEND_COPY, analyzer)
        print(f"\nAlso enriched {fe_n} signals -> {FRONTEND_COPY}")


if __name__ == "__main__":
    main()
