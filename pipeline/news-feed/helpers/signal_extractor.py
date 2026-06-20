"""KYC drift screening: keep the news articles that may move a customer's risk.

This is the final pipeline stage. It assumes article_selection.py has already
run in KYC batch mode (`--kyc-db`), leaving one selected/<company_id>.json per
customer. For each of those, this:

  1. loads the customer's pre-selected news articles,
  2. asks a local LLM (gemma3:4b via Ollama), in parallel, a single screening
     question per article: does this bring a NOTABLE CHANGE to the company that
     could make its risk profile diverge from the KYC baseline? — yes/no, and
  3. for the kept articles, records which drift dimension it is and which OTHER
     players named in the article are linked to that change.

The LLM only SELECTS and tags. It does not score severity or recommend actions
— severity, re-rating, and recommended actions are downstream decisions made
from this output, not asked of a 4B model.

Reads:  ../../docs/kyc_database.json (baselines), selected/<company_id>.json
Writes: kyc_drift_signals.json  (per company: kept articles + dimension + linked entities)

Usage:
    python article_selection.py --kyc-db    # produce selected/<id>.json first
    python signal_extractor.py              # then screen all of them
    python signal_extractor.py --company Boeing
    python signal_extractor.py --max-articles 15 --workers 6
"""

import argparse
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

import brave_search

BASE_DIR = Path(__file__).resolve().parent.parent  # news-feed root (this file lives in helpers/)
KYC_FILE = BASE_DIR.parent.parent / "docs" / "kyc_database.json"
SELECTED_DIR = BASE_DIR / "selected"
OUTPUT_FILE = BASE_DIR / "kyc_drift_signals.json"

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL_NAME = "gemma3:4b"

# Second-stage verifier. After Gemma keeps an article (reading its full text), a
# tiny, fast model re-checks the company + HEADLINE only, to drop "random
# cluster" articles where the company is not really the subject (e.g. a headline
# about Air Force One that only involves Boeing as the plane maker). Title-only
# on a 1.2B model is a cheap noise filter, not a precise judge — so it fails open
# (keeps) on any error, and only drops headlines it is confident are off-topic.
VERIFY_MODEL = "tomng/lfm2.5-instruct:1.2b"

# How much article body to show the model. 4B models stay sharper on shorter
# context, and the lead of a news story carries the material facts anyway.
MAX_ARTICLE_CHARS = 2000

# How many articles to screen concurrently. Ollama serves requests in parallel
# (up to its own OLLAMA_NUM_PARALLEL); excess requests queue server-side. A
# handful of workers keeps the GPU/CPU busy without thrashing memory.
DEFAULT_WORKERS = 4

# Relevance gate: minimum NER mentions for an article to be screened at all.
# Kept at 1 (a sanity floor) on purpose: mention count is too blunt a precision
# lever — terse but material events (a CFO change or sanction in a one-line
# market roundup) carry a single mention yet are exactly the drift we want.
MIN_MENTIONS = 1

# Drift dimensions we care about, mirroring the README risk table. The model
# must classify a kept article into exactly one of these.
DRIFT_DIMENSIONS = [
    "business_model_change",
    "activity_volume_change",
    "key_personnel_change",
    "ownership_change",
    "jurisdiction_structure_change",
    "adverse_media_legal",
    "sanctions_regulatory",
]

PROMPT_TEMPLATE = """You are a strict KYC/AML analyst screening news for risk-profile drift. A bank holds this onboarding baseline for a customer:

Legal name: {legal_name}
Expected business model: {business_model}
Expected activity and volumes: {activity_volumes}
Key personnel: {key_personnel}

Below is a recent news article. Answer ONE question: does it describe a NOTABLE CHANGE to {legal_name} that could make its risk profile diverge from the baseline above?

Apply these rules strictly. When in doubt, answer no:
- Yes ONLY if {legal_name} ITSELF is undergoing the change: new owners/shareholders, management change, a pivot in what it does, sanctions, fraud or legal action, a real jump in transaction scale, or a move of jurisdiction or legal form.
- {legal_name} doing its NORMAL EXPECTED business is NOT a change (e.g. an aircraft maker selling/being ordered aircraft, a drugmaker developing drugs). Answer no.
- If {legal_name} is only mentioned in passing or as background with no specific event about it, answer no. BUT a specific corporate event about {legal_name} (e.g. a CFO/CEO change, a lawsuit, a sanction, an acquisition) still counts as yes EVEN IF it is reported inside a multi-company roundup or market-movers article.
- Routine product launches, opinion, analyst price targets, and pure stock-price moves are NOT changes. Answer no.

If yes, also identify any OTHER players named in the article that are linked to this change (e.g. an acquirer, a new owner or shareholder, a regulator, a court, a partner, an incoming/outgoing executive).

NEWS TITLE: {title}
NEWS BODY: {body}

Respond ONLY as JSON with this exact shape:
{{
  "notable_change": true or false,
  "dimension": one of [{dimensions}] or null,
  "linked_entities": [{{"name": "other player named in the article", "role": "how they relate to the change"}}]
}}

If there is no notable change to {legal_name}, return notable_change=false, dimension=null, linked_entities=[]."""


def load_json(path, what):
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        raise SystemExit(f"{path} not found — {what}")
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Failed to read {path}: {exc}")


def query_llm(prompt, retries=1, model=MODEL_NAME):
    """Call Ollama in JSON mode and parse the response, retrying once on junk."""
    payload = {
        "model": model,
        "format": "json",
        "stream": False,
        "options": {"temperature": 0},
        "prompt": prompt,
    }
    for attempt in range(retries + 1):
        try:
            resp = requests.post(OLLAMA_URL, json=payload, timeout=120)
            resp.raise_for_status()
            raw = resp.json().get("response", "")
            return json.loads(raw)
        except (requests.RequestException, json.JSONDecodeError, ValueError):
            if attempt == retries:
                return None
    return None


VERIFY_PROMPT = """You filter news headlines for a KYC review of "{company}".

Keep the headline ONLY if it is about {company} itself (its ticker symbol or short name counts as {company}). Drop it if {company} is absent from the headline, is just one of several companies listed, or the headline is mainly about a different company, a person, a government, or general markets.

Headline: "{title}"
Respond ONLY as JSON: {{"keep": true or false}}"""


def verify_keep(company, title):
    """Title-only second opinion: should this kept article survive? Fails open."""
    result = query_llm(VERIFY_PROMPT.format(company=company, title=title), model=VERIFY_MODEL)
    if not isinstance(result, dict) or "keep" not in result:
        return True  # verifier glitch — don't drop a Gemma signal over it
    return bool(result["keep"])


def clean_linked_entities(raw):
    """Coerce the model's linked_entities into a list of {name, role}."""
    if not isinstance(raw, list):
        return []
    cleaned = []
    for item in raw:
        if isinstance(item, dict):
            name = str(item.get("name", "")).strip()
            role = str(item.get("role", "")).strip()
        else:
            name, role = str(item).strip(), ""
        if name:
            cleaned.append({"name": name, "role": role})
    return cleaned


def normalize_signal(result):
    """Validate an LLM screening result into a kept-article signal, or None."""
    if not isinstance(result, dict) or not result.get("notable_change"):
        return None
    dimension = result.get("dimension")
    if dimension not in DRIFT_DIMENSIONS:
        return None
    return {
        "dimension": dimension,
        "linked_entities": clean_linked_entities(result.get("linked_entities")),
    }


def format_personnel(personnel):
    if not personnel:
        return "not recorded"
    return ", ".join(f"{role}: {name}" for role, name in personnel.items())


def is_primary_subject(article):
    """True if the customer is a main subject (enough NER mentions), not passing.

    Uses matched_companies[].mentions written by article_selection — the number
    of times the customer's entity was tagged in the body.
    """
    matched_companies = article.get("matched_companies", [])
    top_mentions = max((c.get("mentions", 0) for c in matched_companies), default=0)
    return top_mentions >= MIN_MENTIONS


def build_prompt(customer, article):
    baseline = customer.get("kyc_baseline", {})
    return PROMPT_TEMPLATE.format(
        legal_name=customer.get("legal_name", ""),
        business_model=baseline.get("expected_business_model", "unknown"),
        activity_volumes=baseline.get("expected_activity_and_volumes", "unknown"),
        key_personnel=format_personnel(customer.get("key_personnel")),
        title=article.get("title", ""),
        body=(article.get("clean_text", "") or "")[:MAX_ARTICLE_CHARS],
        dimensions=", ".join(DRIFT_DIMENSIONS),
    )


def screen_article(customer, article):
    """Screen one article; return a kept-article signal dict, or None."""
    signal = normalize_signal(query_llm(build_prompt(customer, article)))
    if not signal:
        return None
    signal["title"] = article.get("title", "")
    signal["url"] = article.get("url", "")
    signal["published_at"] = article.get("published_at", "")
    signal["source"] = article.get("source", "rss")
    signal["summary"] = article.get("summary", "")
    signal["full_text"] = article.get("clean_text", "")
    return signal


def dedupe_by_url(articles):
    """Keep first occurrence of each URL (RSS entries come first, so they win)."""
    seen = set()
    unique = []
    for article in articles:
        url = (article.get("url") or "").strip().rstrip("/")
        if url and url in seen:
            continue
        seen.add(url)
        unique.append(article)
    return unique


def gather_articles(customer, rss_articles, max_articles, use_brave, brave_count):
    """Build the screening set: RSS-selected (gated) + Brave-augmented news."""
    legal_name = customer.get("legal_name", "")

    # RSS: relevance-gate to primary-subject mentions, then cap. Tag the source.
    rss_relevant = [a for a in rss_articles if is_primary_subject(a)][:max_articles]
    for article in rss_relevant:
        article.setdefault("source", "rss")
    rss_skipped = len(rss_articles) - len([a for a in rss_articles if is_primary_subject(a)])

    # Brave: searched by company name, so relevant by construction — no gate.
    brave_articles = (
        brave_search.fetch_company_articles(legal_name, count=brave_count)
        if use_brave else []
    )

    combined = dedupe_by_url(rss_relevant + brave_articles)
    print(f"\n{legal_name}  ({customer.get('company_id', '?')})")
    print(f"  RSS: {len(rss_relevant)} kept (skipped {rss_skipped} passing-mention)"
          f"   Brave: {len(brave_articles)}"
          f"   -> screening {len(combined)} unique")
    return combined


def verify_signals(customer, signals, workers):
    """Second pass: drop kept articles the title-only verifier rules off-topic."""
    legal_name = customer.get("legal_name", "")
    with ThreadPoolExecutor(max_workers=workers) as pool:
        verdicts = list(pool.map(
            lambda s: verify_keep(legal_name, s.get("title", "")), signals
        ))
    survivors = [s for s, keep in zip(signals, verdicts) if keep]
    dropped = [s for s, keep in zip(signals, verdicts) if not keep]
    if dropped:
        print(f"  verify ({VERIFY_MODEL.split('/')[-1]}): dropped {len(dropped)} off-topic")
        for s in dropped:
            print(f"    - {s.get('title', '')[:72]}")
    return survivors


def assess_company(customer, articles, workers, verify=True):
    """Screen one customer's prepared article set in parallel; keep the drift ones."""
    if not articles:
        print("  nothing to screen.")
        return articles, []

    signals = []
    done = 0
    total = len(articles)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(screen_article, customer, art): art for art in articles}
        for future in as_completed(futures):
            done += 1
            try:
                signal = future.result()
            except Exception:  # noqa: BLE001 — one bad article shouldn't sink the batch
                signal = None
            if signal:
                signals.append(signal)
            print(f"\r  screening {done}/{total} | kept {len(signals)}", end="", flush=True)
    print()

    # Second-stage title-only verification to drop off-topic clusters.
    if verify and signals:
        signals = verify_signals(customer, signals, workers)

    # Stable output: group by dimension, then by recency.
    signals.sort(key=lambda s: (s["dimension"], s.get("published_at", "")), reverse=True)
    return articles, signals


def load_selected(company_id):
    """Load the pre-selected articles for a customer, or None if absent."""
    path = SELECTED_DIR / f"{company_id}.json"
    if not path.exists():
        return None
    data = load_json(path, "rerun article_selection.py --kyc-db.")
    return data.get("articles", [])


def main():
    parser = argparse.ArgumentParser(description="Screen news for KYC drift vs onboarding baseline.")
    parser.add_argument("--company", help="Only assess customers whose legal name contains this")
    parser.add_argument("--max-articles", type=int, default=20, help="Max articles per company (default 20)")
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS,
                        help=f"Concurrent LLM calls (default {DEFAULT_WORKERS})")
    parser.add_argument("--no-brave", action="store_true",
                        help="Skip Brave News augmentation (RSS-selected articles only)")
    parser.add_argument("--brave-count", type=int, default=brave_search.DEFAULT_COUNT,
                        help=f"Brave results per company (default {brave_search.DEFAULT_COUNT})")
    parser.add_argument("--no-verify", action="store_true",
                        help=f"Skip the {VERIFY_MODEL} title-only verification pass")
    args = parser.parse_args()

    customers = load_json(KYC_FILE, "this is the KYC database of customers to monitor.")

    if not SELECTED_DIR.exists():
        raise SystemExit(
            f"{SELECTED_DIR.name}/ not found — run `python article_selection.py --kyc-db` first."
        )

    use_brave = not args.no_brave
    if use_brave and not brave_search.load_api_key():
        print("WARNING: no Brave API key found — continuing with RSS only.")
        use_brave = False

    if args.company:
        needle = args.company.lower()
        customers = [c for c in customers if needle in c.get("legal_name", "").lower()]
        if not customers:
            raise SystemExit(f"No KYC customer matches '{args.company}'.")

    verify = not args.no_verify
    print(f"Customers to assess: {len(customers)}")
    print(f"Model:               {MODEL_NAME}  ({args.workers} workers)")
    print(f"Brave augmentation:  {'on' if use_brave else 'off'}")
    print(f"Title verification:  {VERIFY_MODEL if verify else 'off'}")

    report = []
    for customer in customers:
        rss = load_selected(customer.get("company_id")) or []
        articles = gather_articles(customer, rss, args.max_articles, use_brave, args.brave_count)
        matched, signals = assess_company(customer, articles, args.workers, verify=verify)
        report.append({
            "company_id": customer.get("company_id"),
            "legal_name": customer.get("legal_name"),
            "articles_screened": len(matched),
            "kept_count": len(signals),
            "signals": signals,
        })

    with OUTPUT_FILE.open("w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)

    print(f"\n\n{'='*60}\nDRIFT SCREENING SUMMARY")
    for entry in report:
        dims = ", ".join(sorted({s["dimension"] for s in entry["signals"]})) or "—"
        by_brave = sum(1 for s in entry["signals"] if s.get("source") == "brave")
        by_rss = entry["kept_count"] - by_brave
        print(
            f"  {entry['legal_name']:<24} "
            f"kept {entry['kept_count']}/{entry['articles_screened']} "
            f"(rss {by_rss}, brave {by_brave})  [{dims}]"
        )
    print(f"\nWritten to: {OUTPUT_FILE.name}")


if __name__ == "__main__":
    main()
