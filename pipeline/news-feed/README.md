# News Feed Pipeline

Scrapes financial news, extracts company entities, and screens it against a KYC
baseline to flag news that may move a customer's risk profile (KYC drift).

## Setup

```bash
pip install -r ../../requirements.txt
```

- First run of the NER step downloads the GLiNER model (~1.5 GB) to `~/.cache/huggingface` (one time).
- The screening step needs a local Ollama with `gemma3:4b` (`ollama pull gemma3:4b`).
- Brave augmentation needs an API key in `config/brave.key.local` (gitignored) or the `BRAVE_API_KEY` env var.

## Run

One command runs the whole pipeline:

```bash
python3 execute.py                 # full pipeline -> kyc_drift_signals.json
python3 execute.py --skip-scrape   # reuse news.json (skip the slow RSS scrape)
python3 execute.py --skip-ner      # reuse news_entities.json (skip the slow NER)
python3 execute.py --no-brave --workers 6 --company Revolut
```

## Layout

```
news-feed/
  execute.py              orchestrator (entry point)
  kyc_drift_signals.json  final output (generated, gitignored)
  README.md
  config/                 rss_sources.txt, brave.key.local (gitignored)
  helpers/                pipeline stages (see below)
```

All generated data — `news.json`, `news_entities.json`, `selected/`,
`kyc_drift_signals.json` — is written to the news-feed root and gitignored.

## Stages (in `helpers/`, run in order by `execute.py`)

| # | Stage | Reads | Writes |
|---|-------|-------|--------|
| 1 | `news_pipeline.py` | `config/rss_sources.txt` | `news.json` |
| 2 | `entity_extractor.py` | `news.json` | `news_entities.json` |
| 3 | `article_selection.py --kyc-db` | `news_entities.json`, `../../docs/kyc_database.json` | `selected/<company_id>.json` |
| 4 | `signal_extractor.py` | `selected/`, `../../docs/kyc_database.json`, Brave | `kyc_drift_signals.json` |

1. **news_pipeline.py** — fetches all RSS feeds concurrently, keeps the last 720h (~30 days), resolves Google News links, scrapes article text (trafilatura), dedups, writes one JSON.
2. **entity_extractor.py** — runs GLiNER (`company` label) over each article's `clean_text` and adds a `companies` field (`name`, `score`, `mentions`). Prints the top companies as a quality check.
3. **article_selection.py** — `--kyc-db` selects, for every customer in the KYC DB, the articles where it appears as an entity, writing one `selected/<company_id>.json` each. (Single-company mode `article_selection.py "Apple"` still works, writing `selected_articles.json`.) Matching is open (case/punctuation-insensitive, token-subsequence), so `Apple` matches `Apple Inc.` and `apple` but not `Snapple`.
4. **signal_extractor.py** — for each customer, screens its selected articles **plus Brave News results** (`"<company> news"`, last month, top 20, scraped the same way) with `gemma3:4b` in parallel. Gemma answers a single question per article — does this bring a notable change that could make the risk profile diverge? — and for kept articles records the drift `dimension` and any `linked_entities` (other players tied to the change). Output per company lists the kept articles with `dimension`, `linked_entities`, `source` (`rss`/`brave`), `summary`, and `full_text`.

You can still run any stage directly, e.g. `python3 helpers/signal_extractor.py --company Boeing`.

## Config

- **Feeds:** edit `config/rss_sources.txt` (one URL per line, `#` for comments).
- **Lookback / workers:** `LOOKBACK_HOURS`, `MAX_WORKERS` in `helpers/news_pipeline.py`.
- **NER model / threshold:** `MODEL_NAME`, `THRESHOLD` in `helpers/entity_extractor.py` (swap to `urchade/gliner_small-v2.1` for speed).
- **Screening:** `MODEL_NAME`, `MIN_MENTIONS`, `MAX_ARTICLE_CHARS` in `helpers/signal_extractor.py`. Flags: `--no-brave`, `--brave-count`, `--workers`, `--company`, `--max-articles`.
- **Brave parallelism:** real concurrency needs the Ollama server started with `OLLAMA_NUM_PARALLEL=4` (otherwise requests queue server-side).
