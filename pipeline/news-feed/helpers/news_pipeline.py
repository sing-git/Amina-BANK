"""News pipeline: ingest RSS feeds + scrape article text, output one JSON file.

Reads RSS sources from config/rss_sources.txt, keeps entries from the last 24h,
resolves Google News redirect URLs, scrapes the full article text, builds a
summary, deduplicates, and writes the result to news.json.

Usage:
    python news_pipeline.py
"""

import hashlib
import html as html_lib
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import feedparser
import requests
import trafilatura

BASE_DIR = Path(__file__).resolve().parent.parent  # news-feed root (this file lives in helpers/)
SOURCES_FILE = BASE_DIR / "config" / "rss_sources.txt"
OUTPUT_FILE = BASE_DIR / "news.json"

LOOKBACK_HOURS = 720  # ~30 days
MIN_ARTICLE_WORDS = 180

# How many feeds / articles to fetch concurrently. Network I/O bound, so we can
# go well above the CPU count.
MAX_WORKERS = 16

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
    ),
    "Cookie": "CONSENT=YES+cb.20210328-17-p0.en+FX+667; SOCS=CAISHAgBEhJnd3NfMjAyMzA4MDktMF9SQzEaAmVuIAEaBgiA_LynBg",
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
}

GOOGLE_NEWS_LOCALE_QUERY = "hl=en-US&gl=US&ceid=US:en"


# --------------------------------------------------------------------------- #
# Progress helper
# --------------------------------------------------------------------------- #
def show_progress(label, current, total, extra=""):
    if total <= 0:
        print(f"{label}: 0/0")
        return
    width = 30
    filled = int(width * current / total)
    bar = "#" * filled + "-" * (width - filled)
    suffix = f" | {extra}" if extra else ""
    sys.stdout.write(f"\r{label}: [{bar}] {current}/{total}{suffix}")
    sys.stdout.flush()
    if current >= total:
        sys.stdout.write("\n")


# --------------------------------------------------------------------------- #
# Google News URL resolution
# --------------------------------------------------------------------------- #
def _extract_google_article_id(url):
    match = re.search(r"/(?:rss/)?articles/([^/?#]+)", url)
    return match.group(1) if match else None


def _decode_google_news_article_id(article_id):
    article_url = f"https://news.google.com/rss/articles/{article_id}?{GOOGLE_NEWS_LOCALE_QUERY}"
    page = requests.get(article_url, headers=HEADERS, timeout=10, allow_redirects=True)

    signature_match = re.search(r'data-n-a-sg="([^"]+)"', page.text)
    timestamp_match = re.search(r'data-n-a-ts="([^"]+)"', page.text)
    if not signature_match or not timestamp_match:
        return None
    signature, timestamp = signature_match.group(1), timestamp_match.group(1)

    payload = [
        "Fbv4je",
        (
            '["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,'
            f'null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"{article_id}",'
            f'{timestamp},"{signature}"]'
        ),
    ]
    response = requests.post(
        "https://news.google.com/_/DotsSplashUi/data/batchexecute",
        headers={
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "User-Agent": HEADERS["User-Agent"],
        },
        data={"f.req": json.dumps([[payload]])},
        timeout=10,
    )
    response.raise_for_status()

    parts = response.text.split("\n\n")
    if len(parts) < 2:
        return None
    data = json.loads(parts[1])
    if not data:
        return None
    decoded = json.loads(data[0][2])[1]
    if isinstance(decoded, str) and decoded.startswith("http"):
        return decoded
    return None


def resolve_google_url(url):
    if "news.google.com" not in url:
        return url
    try:
        response = requests.get(url, headers=HEADERS, timeout=10, allow_redirects=True)
        if "google.com" not in response.url:
            return response.url

        article_id = _extract_google_article_id(url)
        if not article_id:
            return url
        decoded = _decode_google_news_article_id(article_id)
        if decoded and "google.com" not in decoded:
            return decoded
        return url
    except Exception:
        return url


# --------------------------------------------------------------------------- #
# Feed ingest
# --------------------------------------------------------------------------- #
def read_feed_urls(path):
    with path.open("r", encoding="utf-8") as handle:
        return [
            line.strip()
            for line in handle
            if line.strip() and not line.lstrip().startswith("#")
        ]


def get_entry_datetime(entry):
    parsed = entry.get("published_parsed") or entry.get("updated_parsed")
    if not parsed:
        return None
    try:
        return datetime(*parsed[:6], tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def fetch_feed_entries(feed_url):
    try:
        response = requests.get(feed_url, headers=HEADERS, timeout=15)
        feed = feedparser.parse(response.content)
    except Exception as exc:
        print(f"\nSkipping feed {feed_url}: {exc}")
        return []

    if getattr(feed, "status", 200) >= 400:
        print(f"\nSkipping feed {feed_url}: HTTP {feed.status}")
        return []

    return [{"feed_url": feed_url, "entry": entry} for entry in getattr(feed, "entries", [])]


def collect_candidates(feed_urls, cutoff):
    """Fetch all feeds, keep recent entries with a title + url, dedup by url/title.

    Feeds are fetched concurrently, and the surviving Google News links are
    resolved concurrently — both are network-bound and dominate runtime.
    """
    all_entries = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        done = 0
        for entries in executor.map(fetch_feed_entries, feed_urls):
            all_entries.extend(entries)
            done += 1
            show_progress("Fetching feeds", done, len(feed_urls), f"entries {len(all_entries)}")

    # Cheap pass first: keep recent entries that have a title and a link, before
    # spending any network on URL resolution.
    pre_candidates = []
    for item in all_entries:
        entry = item["entry"]
        published_at = get_entry_datetime(entry)
        if not published_at or published_at < cutoff:
            continue
        title = entry.get("title", "").strip()
        link = entry.get("link", "").strip()
        if not title or not link:
            continue
        pre_candidates.append(
            {
                "source_feed": item["feed_url"],
                "title": title,
                "link": link,
                "summary": entry.get("summary", "").strip(),
                "published_at": published_at.isoformat(),
            }
        )

    # Resolve Google News redirect links in parallel.
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        resolved_urls = list(executor.map(lambda c: resolve_google_url(c["link"]), pre_candidates))

    candidates = []
    seen_urls = set()
    seen_hashes = set()
    for cand, url in zip(pre_candidates, resolved_urls):
        if not url:
            continue
        title_hash = hashlib.md5(cand["title"].encode()).hexdigest()
        if url in seen_urls or title_hash in seen_hashes:
            continue
        seen_urls.add(url)
        seen_hashes.add(title_hash)
        candidates.append(
            {
                "source_feed": cand["source_feed"],
                "title": cand["title"],
                "url": url,
                "summary": cand["summary"],
                "published_at": cand["published_at"],
                "title_hash": title_hash,
            }
        )

    print(f"Recent entries (last {LOOKBACK_HOURS}h): {len(pre_candidates)}")
    candidates.sort(key=lambda item: item["published_at"], reverse=True)
    return candidates


# --------------------------------------------------------------------------- #
# Text cleaning + summarization
# --------------------------------------------------------------------------- #
def clean_text(text):
    text = re.sub(r"\r\n?", "\n", text or "")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()


def clean_summary_text(summary):
    summary = summary or ""
    summary = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", summary)
    summary = re.sub(r"(?i)<br\s*/?>", " ", summary)
    summary = re.sub(r"(?i)</p\s*>", " ", summary)
    summary = re.sub(r"<[^>]+>", " ", summary)
    summary = html_lib.unescape(summary)
    return re.sub(r"\s+", " ", summary).strip()


def normalize_for_match(text):
    text = text or ""
    text = re.sub(r"\s*-\s*[^-]+$", "", text).strip()
    text = text.lower()
    text = re.sub(r"[^\w\s]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def summary_is_usable(summary, title):
    if not summary or len(summary.split()) < 8:
        return False
    summary_norm = normalize_for_match(summary)
    title_norm = normalize_for_match(title)
    if title_norm and (
        summary_norm == title_norm
        or summary_norm.startswith(title_norm)
        or title_norm.startswith(summary_norm)
    ):
        return False
    return True


def summarize_from_text(text, max_words=45):
    text = re.sub(r"\s+", " ", text or "").strip()
    if not text:
        return ""

    sentences = re.split(r"(?<=[.!?])\s+", text)
    selected = []
    words_used = 0
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        sentence_words = sentence.split()
        if words_used and words_used + len(sentence_words) > max_words:
            break
        selected.append(sentence)
        words_used += len(sentence_words)
        if words_used >= max_words:
            break

    if not selected:
        selected = [" ".join(text.split()[:max_words])]

    summary = " ".join(selected).strip()
    if len(summary.split()) < len(text.split()) and not summary.endswith((".", "!", "?")):
        summary = f"{summary}..."
    return summary


def build_summary(feed_summary, title, article_text):
    cleaned = clean_summary_text(feed_summary)
    if summary_is_usable(cleaned, title):
        return cleaned
    generated = summarize_from_text(article_text)
    return generated or cleaned


def extract_article_text(html):
    try:
        text = trafilatura.extract(
            html,
            include_links=False,
            include_tables=False,
            output_format="txt",
        )
    except Exception:
        return ""
    return clean_text(text)


# --------------------------------------------------------------------------- #
# Scrape
# --------------------------------------------------------------------------- #
def fetch_html(session, url):
    try:
        response = session.get(url, headers=HEADERS, timeout=10)
    except requests.RequestException:
        return None
    if response.status_code != 200:
        return None
    return response.text


def text_fingerprint(text):
    snippet = re.sub(r"[^\w\s]", "", (text or "").lower())
    snippet = re.sub(r"\s+", " ", snippet).strip()[:1000]
    return hashlib.md5(snippet.encode()).hexdigest()


def fetch_and_extract(session, article):
    """Worker: fetch + extract one article's text. Returns (article, text|None)."""
    html = fetch_html(session, article["url"])
    if not html:
        return article, None
    return article, extract_article_text(html)


def scrape_articles(candidates):
    articles = []
    stats = {"fetch_failed": 0, "extract_failed": 0, "short_articles": 0, "duplicate": 0}
    seen_fingerprints = set()
    total = len(candidates)

    if not total:
        show_progress("Scraping articles", 0, 0)
        return articles, stats

    # Fetch + extract concurrently (network-bound); dedup/append serially in the
    # main thread so the shared state stays consistent without locks.
    session = requests.Session()
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        results = executor.map(lambda a: fetch_and_extract(session, a), candidates)

        for index, (article, text) in enumerate(results, 1):
            if text is None:
                stats["fetch_failed"] += 1
            elif not text:
                stats["extract_failed"] += 1
            elif len(text.split()) < MIN_ARTICLE_WORDS:
                stats["short_articles"] += 1
            else:
                fingerprint = text_fingerprint(text)
                if fingerprint in seen_fingerprints:
                    stats["duplicate"] += 1
                else:
                    seen_fingerprints.add(fingerprint)
                    articles.append(
                        {
                            "source_feed": article["source_feed"],
                            "title": article["title"],
                            "url": article["url"],
                            "summary": build_summary(
                                article["summary"], article["title"], text
                            ),
                            "published_at": article["published_at"],
                            "clean_text": text,
                            "word_count": len(text.split()),
                            "title_hash": article["title_hash"],
                        }
                    )
            show_progress("Scraping articles", index, total, f"kept {len(articles)}")

    session.close()
    return articles, stats


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main():
    try:
        feed_urls = read_feed_urls(SOURCES_FILE)
    except OSError as exc:
        print(f"Failed to read {SOURCES_FILE}: {exc}")
        return

    cutoff = datetime.now(timezone.utc) - timedelta(hours=LOOKBACK_HOURS)
    candidates = collect_candidates(feed_urls, cutoff)
    print(f"Candidate articles: {len(candidates)}")

    articles, stats = scrape_articles(candidates)

    with OUTPUT_FILE.open("w", encoding="utf-8") as handle:
        json.dump(articles, handle, indent=2)

    print(f"Feeds processed:           {len(feed_urls)}")
    print(f"Candidates (last {LOOKBACK_HOURS}h):   {len(candidates)}")
    print(f"Skipped failed fetches:    {stats['fetch_failed']}")
    print(f"Skipped failed extraction: {stats['extract_failed']}")
    print(f"Skipped short articles:    {stats['short_articles']}")
    print(f"Skipped duplicates:        {stats['duplicate']}")
    print(f"Articles written to {OUTPUT_FILE.name}: {len(articles)}")


if __name__ == "__main__":
    main()
