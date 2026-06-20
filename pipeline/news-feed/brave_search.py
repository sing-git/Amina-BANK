"""Brave News search to augment the RSS corpus for KYC drift screening.

For a given company this queries the Brave News API ("<company> news", last
month, top results), then scrapes each result URL into the same article shape
the RSS pipeline produces (title, url, summary, clean_text, published_at) so the
downstream Gemma screening treats Brave and RSS articles identically.

API key resolution (first hit wins):
    1. env var BRAVE_API_KEY
    2. config/brave.key.local   (gitignored)

Usage (standalone smoke test):
    python brave_search.py "Pfizer Inc."
"""

import os
import sys
from concurrent.futures import ThreadPoolExecutor

import requests

# Reuse the RSS pipeline's scraping + summary helpers so Brave articles end up
# byte-for-byte compatible with news.json entries.
from news_pipeline import (
    MIN_ARTICLE_WORDS,
    build_summary,
    extract_article_text,
    fetch_html,
)

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
KEY_FILE = BASE_DIR / "config" / "brave.key.local"

BRAVE_NEWS_URL = "https://api.search.brave.com/res/v1/news/search"
DEFAULT_COUNT = 20
DEFAULT_FRESHNESS = "pm"  # past month
SCRAPE_WORKERS = 8


def load_api_key():
    key = os.environ.get("BRAVE_API_KEY")
    if key:
        return key.strip()
    if KEY_FILE.exists():
        return KEY_FILE.read_text(encoding="utf-8").strip()
    return None


def search_news(company, api_key, count=DEFAULT_COUNT, freshness=DEFAULT_FRESHNESS):
    """Return raw Brave News results for "<company> news", or [] on failure."""
    headers = {"Accept": "application/json", "X-Subscription-Token": api_key}
    params = {
        "q": f"{company} news",
        "count": count,
        "freshness": freshness,
        "spellcheck": 0,
    }
    try:
        resp = requests.get(BRAVE_NEWS_URL, headers=headers, params=params, timeout=20)
        resp.raise_for_status()
        return resp.json().get("results", [])
    except requests.RequestException as exc:
        print(f"  Brave search failed for {company!r}: {exc}")
        return []


def _result_published_at(result):
    """Prefer a machine ISO date (page_age); fall back to the human 'age' string."""
    return result.get("page_age") or result.get("age") or ""


def _scrape_result(session, result):
    """Fetch + extract one Brave result into an article dict, or None if unusable."""
    url = result.get("url")
    if not url:
        return None
    html = fetch_html(session, url)
    if not html:
        return None
    text = extract_article_text(html)
    if not text or len(text.split()) < MIN_ARTICLE_WORDS:
        return None
    title = (result.get("title") or "").strip()
    description = (result.get("description") or "").strip()
    return {
        "source": "brave",
        "source_feed": "brave_news",
        "title": title,
        "url": url,
        "summary": build_summary(description, title, text),
        "published_at": _result_published_at(result),
        "clean_text": text,
        "word_count": len(text.split()),
    }


def fetch_company_articles(company, count=DEFAULT_COUNT, freshness=DEFAULT_FRESHNESS, api_key=None):
    """Search Brave for a company and return scraped, RSS-compatible articles."""
    api_key = api_key or load_api_key()
    if not api_key:
        print("  Brave API key not found (set BRAVE_API_KEY or config/brave.key.local).")
        return []

    results = search_news(company, api_key, count=count, freshness=freshness)
    if not results:
        return []

    session = requests.Session()
    with ThreadPoolExecutor(max_workers=SCRAPE_WORKERS) as pool:
        scraped = list(pool.map(lambda r: _scrape_result(session, r), results))
    return [a for a in scraped if a]


def main():
    if len(sys.argv) < 2:
        print("usage: python brave_search.py \"Company Name\"")
        return
    company = " ".join(sys.argv[1:])
    articles = fetch_company_articles(company)
    print(f"{company}: {len(articles)} usable articles from Brave")
    for art in articles[:10]:
        print(f"  - [{art['word_count']:>4}w] {art['title'][:80]}")


if __name__ == "__main__":
    main()
