# Sanctions Screening

Screens company names against sanctions lists (OFAC, UN, OpenSanctions) using
fuzzy name matching, and cross-references KYC customers + their news-linked
entities against those lists.

## Setup

```bash
pip install -r ../requirements.txt
```

No manual data download needed — source files are fetched automatically on
first run (see Sources below).

## Run

Two entry points (run from the project root, so Python can find the
`sanctions` package):

```bash
python -m sanctions.cli "Company Name"   # check a single company name
python -m sanctions.kyc_check            # screen every KYC customer + their news-linked entities
```

Examples:

```bash
python -m sanctions.cli "Banco Nacional de Cuba"
python -m sanctions.cli "Acme Corp" --threshold 90 --limit 5
python -m sanctions.kyc_check --threshold 90
```

## kyc_check.py in detail

Reads:
- `../docs/kyc_database.json` — every customer's own legal name
- `../scrapers/news-feed/kyc_drift_signals.json` — every "linked entity" named
  in drift-relevant news about a customer (e.g. an acquirer, new shareholder,
  regulator, or partner)

Screens every one of those names against all sanctions sources. A match on
either is a strong, explainable risk signal: either the bank's own customer
is sanctioned, or a customer is news-linked to a sanctioned entity.

Writes `sanctions/kyc_sanctions_flags.json` (gitignored, regenerated every
run — it's overwritten even when nothing is flagged, so a clean run never
leaves a stale alert sitting around) with full details on anything matched:
the score, which list/program it's on, and where the name came from (which
customer, which article/role).

If `kyc_drift_signals.json` doesn't exist yet (the news-feed pipeline hasn't
been run), only the KYC customers themselves get screened.

## Layout

```
sanctions/
  cli.py            entry point: python -m sanctions.cli
  kyc_check.py      entry point: python -m sanctions.kyc_check
  models.py         SanctionRecord / Match data shapes
  matcher.py        normalization + fuzzy matching (SanctionIndex, screen())
  cache.py          parsed-records cache (keyed by source file size+mtime)
  download.py       fetches/refreshes source files from OFAC/UN/OpenSanctions
  registry.py       loads + combines all sources, with auto-refresh
  sources/          one parser per source (ofac.py, un.py, opensanctions.py)
  data/             downloaded source files (gitignored, auto-fetched)
  .cache/           parsed records cache (gitignored, auto-generated)
  kyc_sanctions_flags.json   kyc_check.py output (gitignored, auto-generated)
```

## Sources

| Source | Coverage | Refresh |
|---|---|---|
| OFAC SDN List | US sanctions | auto-downloaded, refreshed every 7 days |
| UN Security Council Consolidated List | UN sanctions, many committees | auto-downloaded, refreshed every 7 days |
| OpenSanctions Consolidated Sanctions | ~50 national/international lists, incl. EU, UK, Switzerland | auto-downloaded, refreshed every 7 days |

No manual download needed on any machine — the first run fetches everything
into `data/`, and a local copy older than 7 days is refreshed automatically.
If a refresh fails (e.g. no internet), the existing copy is used instead of
failing outright.

**Licensing note:** OpenSanctions' bulk data is CC BY-NC 4.0 — free for
non-commercial/research use (this hackathon), but a business deploying this
for real screening would need a commercial license from OpenSanctions. See
https://www.opensanctions.org/licensing/.

## Notes on matching

- Names are normalized (uppercased, punctuation stripped, legal suffixes like
  Ltd/Inc/GmbH/AG removed) before comparison.
- Matching is fuzzy and word-weighted: rare/distinctive words (e.g. "CUBA")
  count far more than common words (e.g. "BANK", "NATIONAL") shared by
  thousands of names — this is what stops "National Bank of Cuba" from
  falsely matching "National Bank of Iran".
- Short single-word names (6 characters or fewer) use a stricter
  edit-distance check instead of a percentage score, to avoid false
  positives like "UBS" vs "UBIS" or "Roche" vs "Rochel".
- Default match threshold is 85/100 — adjust with `--threshold`.
- By default only companies (`Entity`) are screened, not
  individuals/vessels/aircraft — add `--all-types` to include them.
