# Test coverage status

_Last measured: 2026-06-20, on branch `add-unit-tests`._

## Headline number

**~13% of functions in the codebase currently have a direct test (30 of ~225).**

This counts the Python scrapers (`scrapers/`) and the Node/TypeScript backend (`backend/src/`). The frontend (`frontend/`) is excluded — it's React UI components, not the kind of standalone function most unit tests target; testing it would need a different tool (e.g. React Testing Library), not more of what's below.

**Why "~" and not an exact number:** the Python count (130 functions) is exact — Python functions all start with the keyword `def`, so they're unambiguous to count. The TypeScript count (~95 functions) is an estimate from pattern-matching `function` declarations and arrow-functions assigned to a `const` — TypeScript allows many ways to write a function, so a few unusual ones may be missed. One deliberate exclusion: `server.ts`'s ~9 HTTP route handlers (`app.get("/api/...", (req, res) => {...})`) are anonymous functions passed inline as arguments, not separately named — they're not counted as individual functions here, the same way you wouldn't count each `.map(x => ...)` callback elsewhere in the code.

## What counts as "tested" here

A function counts as tested only if a test file directly imports it and makes an assertion that depends on its behavior. This is a stricter bar than "code coverage" tools normally use — those would also count a helper function as "covered" just because some other, directly-tested function happens to call it internally on its way to producing a result. Counting it that way would make the percentage look better than the reality of what's actually been individually verified.

## By area

| Area | Functions | Tested | % |
|---|---|---|---|
| Python scrapers (`scrapers/`) | 130 | 30 | 23% |
| Node/TypeScript backend (`backend/src/`) | ~95 | 0 | 0% |
| **Combined** | **~225** | **30** | **~13%** |

The backend has zero tests so far because the test-writing work done this session only covered the Python side (`scrapers/`) — the backend (TypeScript) test plan was written and approved but not yet implemented. See "What's next" below.

## Python scrapers — file by file

| File | Functions | Tested | Notes |
|---|---|---|---|
| `scrapers/sanctions/matcher.py` | 9 | 6 | The core name-matching algorithm — highest-value file, mostly covered. `_word_weights`, `_weight`, `_directional_match` run *inside* the tested functions but aren't separately asserted on. |
| `scrapers/sanctions/sources/opensanctions.py` | 2 | 2 | Fully covered. |
| `scrapers/sanctions/sources/ofac.py` | 2 | 1 | `parse()` tested; its tiny `_text()` helper isn't separately asserted on. |
| `scrapers/sanctions/sources/un.py` | 4 | 1 | Same pattern — `parse()` tested, its 3 small helpers aren't separately asserted on. |
| `scrapers/sanctions/cache.py` | 2 | 1 | `_cache_key()` tested; `load_or_build()` (the part that actually reads/writes files) deferred — needs file-system mocking. |
| `scrapers/news-feed/helpers/article_selection.py` | 11 | 6 | All the pure name-matching logic tested; the file-reading/writing/CLI parts (5 functions) deferred. |
| `scrapers/news-feed/helpers/news_pipeline.py` | 20 | 7 | The text-cleanup functions tested; the network-scraping/RSS-fetching parts (13 functions) deferred — need a live internet connection to test realistically. |
| `scrapers/news-feed/helpers/signal_extractor.py` | 15 | 5 | The AI-response validation functions tested; the actual AI-calling functions (10 functions) deferred — calling a live AI model isn't repeatable. |
| `scrapers/corporate/comparedata.py` | 7 | 1 | `detect_registry_changes()` (the actual comparison logic) tested; the 5 live-API-calling functions deferred. |
| `scrapers/sanctions/cli.py` | 1 | 0 | Thin command-line wrapper around already-tested `matcher.py`/`registry.py` — low value to test separately. |
| `scrapers/sanctions/kyc_check.py` | 5 | 0 | Same — orchestrates already-tested pieces plus file I/O. |
| `scrapers/sanctions/registry.py` | 2 | 0 | Downloads/caches sanctions files from the internet — needs network mocking, not done yet. |
| `scrapers/sanctions/download.py` | 5 | 0 | Pure network code (downloads official sanctions list files) — not done yet. |
| `scrapers/news-feed/helpers/brave_search.py` | 6 | 0 | Calls the Brave Search API — needs network mocking, not done yet. |
| `scrapers/news-feed/helpers/entity_extractor.py` | 5 | 0 | Runs an AI model (GLiNER) to find company names in text — needs a live/mocked model, not done yet. |
| `scrapers/news-feed/execute.py` | 3 | 0 | Orchestrates the other scripts as subprocesses — not done yet. |
| `scrapers/sanctions/models.py` | 0 | — | Just data shape definitions, no logic to test. |

### Found while compiling this report — not yet covered by anything

Three files turned up that weren't part of the original test-writing pass at all:

| File | Functions | What it does |
|---|---|---|
| `scrapers/news-feed/domain_monitor.py` | 15 | Monitors a company's website/domain for changes (WHOIS, Wayback Machine, SecurityTrails, Firecrawl, Diffbot lookups) |
| `scrapers/news-feed/stage_scorer.py` | 12 | Scores news articles for KYC risk drift (entity matching, sanctions lookup, embedding-based drift scoring) |
| `scrapers/news-feed/run_stage1.py` | 4 | A small CLI runner that calls the other two |

These are almost entirely network/API-calling code, similar in shape to the already-deferred files above — but flagging them here since they were missed in the original scope and currently have 0% coverage.

## Node/TypeScript backend — by file (all currently 0% tested)

No backend tests exist yet. A detailed plan for adding them (which functions, which test cases, in plain English) was already written and approved — see the plan saved at the time, covering: the 4 fraud-detection formulas (`ruleDiff.ts`), the overall risk-score calculator (`scoringEngine.ts`), score-to-risk-label boundaries (`policy.ts`), the transaction-summary generator (`timeseries.ts`), text-similarity math (`embeddings.ts`), signal routing (`classifyRawSignal.ts`), recommended-action lookups (`recommendations.ts`), the 3 data-file readers (`kycAdapter.ts`/`newsAdapter.ts`/`sanctionsAdapter.ts`), and pulling structured data out of AI replies (`llm.ts`).

Highest-value untested files, by function count: `llm.ts` (15), `ruleDiff.ts` (10), `embeddings.ts` (10), `mcpNews.ts` (4), `kycAdapter.ts` (4).

## What's next

The straightforward way to raise this percentage meaningfully:
1. Implement the already-approved backend (TypeScript) test plan — would add roughly 90-130 tests covering the highest-value ~50 functions, pushing the combined percentage from ~13% to somewhere around 55-60%.
2. Decide whether the three newly-found scraper files (`domain_monitor.py`, `stage_scorer.py`, `run_stage1.py`) are worth testing — they're mostly live-API code, so any tests would need to mock those API calls first.
