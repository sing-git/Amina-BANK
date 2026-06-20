# Scrapers — Layer 1 data collection (Python)

Team-built Python scrapers that gather public signals. They are a **separate layer** from
the TypeScript scoring engine (`/backend`) and dashboard (`/frontend`): scrapers *collect*,
the backend *scores*.

```
scrapers/
├── news-feed/        # Giulio — RSS scrape → article text → GLiNER NER → per-company articles
├── corporate/        # Alice  — registry compare (jurisdiction / legal-form drift)
├── sanctions/        # Kiara  — sanctions list match (TODO: add branch)
└── requirements.txt  # shared Python deps
```

## Setup
```bash
cd scrapers
pip install -r requirements.txt
```

## news-feed (Giulio)
```bash
cd news-feed
python3 news_pipeline.py                  # RSS → news.json
python3 entity_extractor.py               # news.json → news_entities.json (company NER)
python3 article_selection.py "Revolut"    # → articles_<company>.json
```

## corporate (Alice)
`comparedata.py` loads the synthetic KYC DB (`../../data/kyc_database.json`), simulates a
registry fetch (OpenCorporates / ZEFIX), and flags jurisdiction / legal-form changes.

---

## Integration contract → `RawSignal`

Each scraper's output is mapped to our common `RawSignal` schema (backend/src/types.ts) so
the TS pipeline can route it. **One adapter per source** does this mapping:

| Scraper | Output | → RawSignal |
|---|---|---|
| news-feed | `articles_<co>.json` (title, url, clean_text) | `{ sourceType:"news", rawText:clean_text, sourceUrl:url, category:"negative_news" }` |
| corporate | jurisdiction/legal-form change | `{ sourceType:"registry", rawText:<change desc>, category:"jurisdiction_change" }` |
| sanctions | exact name match | hard gate `{ matched, matchedEntity }` (not a RawSignal) |

The adapters live in the backend (`backend/src/ingest/`) and can read these JSON outputs
directly, or — preferred — read from Postgres after the scrapers write there (see
`backend/DATABASE.md`). Flow:

```
scraper (Python) → JSON / Postgres → adapter (TS) → RawSignal[] → runPipeline()
```
## Code testing
23% of functions in the codebase have a direct test (30 out of 130 functions)
