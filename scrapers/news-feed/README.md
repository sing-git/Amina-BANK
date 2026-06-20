# News Feed Pipeline

Scrapes financial news, extracts company entities, and lets you pull every article mentioning a given company.

## Setup

```bash
pip install -r ../../requirements.txt
```

First run of the NER step downloads the GLiNER model (~1.5 GB) to `~/.cache/huggingface` (one time).

## Steps

Run in order from this directory:

| # | Command | Reads | Writes |
|---|---------|-------|--------|
| 1 | `python3 news_pipeline.py` | `config/rss_sources.txt` | `news.json` |
| 2 | `python3 entity_extractor.py` | `news.json` | `news_entities.json` |
| 3 | `python3 article_selection.py "Revolut"` | `news_entities.json` | `articles_<company>.json` |

1. **news_pipeline.py** — fetches all RSS feeds concurrently, keeps the last 167h, resolves Google News links, scrapes article text (trafilatura), dedups, writes one JSON.
2. **entity_extractor.py** — runs GLiNER (`company` label) over each article's `clean_text` and adds a `companies` field (`name`, `score`, `mentions`). Prints the top companies as a quality check.
3. **article_selection.py** — given a company name, returns only the articles where it appears as an entity. Matching is open (case/punctuation-insensitive, token-subsequence), so `Apple` matches `Apple Inc.` and `apple` but not `Snapple`.

## Config

- **Feeds:** edit `config/rss_sources.txt` (one URL per line, `#` for comments).
- **Lookback / workers:** `LOOKBACK_HOURS`, `MAX_WORKERS` in `news_pipeline.py`.
- **NER model / threshold:** `MODEL_NAME`, `THRESHOLD` in `entity_extractor.py` (swap to `urchade/gliner_small-v2.1` for speed).
