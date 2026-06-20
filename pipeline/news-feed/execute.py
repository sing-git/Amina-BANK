"""End-to-end runner for the KYC drift-detection pipeline.

Runs the four stages in order, each reading the previous one's output:

  1. news_pipeline.py        config/rss_sources.txt      -> news.json
  2. entity_extractor.py     news.json                   -> news_entities.json
  3. article_selection.py    news_entities.json + KYC DB -> selected/<id>.json
  4. signal_extractor.py     selected/ + KYC DB + Brave  -> kyc_drift_signals.json

All four outputs are regenerated artifacts (gitignored). The two slow stages are
scraping (1) and NER (2); use --skip-scrape / --skip-ner to reuse their output
while iterating on selection or screening.

Usage:
    python execute.py                      # full pipeline
    python execute.py --skip-scrape        # reuse news.json
    python execute.py --skip-ner           # reuse news_entities.json (implies --skip-scrape)
    python execute.py --no-brave --workers 6
    python execute.py --company Revolut     # screen one customer (still rebuilds upstream)
"""

import argparse
import subprocess
import sys
import time
from pathlib import Path

import requests

BASE_DIR = Path(__file__).resolve().parent
OLLAMA_TAGS_URL = "http://localhost:11434/api/tags"


def run_stage(number, label, argv):
    """Run one pipeline stage as a subprocess; abort the pipeline if it fails."""
    print(f"\n{'='*64}\n[{number}/4] {label}\n{'='*64}")
    start = time.perf_counter()
    result = subprocess.run([sys.executable, *argv], cwd=BASE_DIR)
    elapsed = time.perf_counter() - start
    if result.returncode != 0:
        raise SystemExit(f"\nStage {number} ({label}) failed — stopping.")
    print(f"\n[{number}/4] {label} done in {elapsed:.1f}s")


def ollama_ready():
    try:
        requests.get(OLLAMA_TAGS_URL, timeout=3).raise_for_status()
        return True
    except requests.RequestException:
        return False


def main():
    parser = argparse.ArgumentParser(description="Run the full KYC drift pipeline.")
    parser.add_argument("--skip-scrape", action="store_true", help="Reuse existing news.json")
    parser.add_argument("--skip-ner", action="store_true",
                        help="Reuse existing news_entities.json (implies --skip-scrape)")
    parser.add_argument("--company", help="Screen only customers whose legal name contains this")
    parser.add_argument("--no-brave", action="store_true", help="Skip Brave News augmentation")
    parser.add_argument("--workers", type=int, default=6, help="Concurrent LLM screening calls")
    parser.add_argument("--max-articles", type=int, default=20, help="Max RSS articles per company")
    args = parser.parse_args()

    skip_scrape = args.skip_scrape or args.skip_ner

    if not ollama_ready():
        raise SystemExit(
            "Ollama is not reachable at localhost:11434 — start it (`ollama serve`) "
            "and ensure gemma3:4b is pulled before running the screening stage."
        )

    overall = time.perf_counter()

    if skip_scrape:
        print("[1/4] news_pipeline — skipped (reusing news.json)")
    else:
        run_stage(1, "news_pipeline — scrape RSS feeds", ["news_pipeline.py"])

    if args.skip_ner:
        print("[2/4] entity_extractor — skipped (reusing news_entities.json)")
    else:
        run_stage(2, "entity_extractor — company NER", ["entity_extractor.py"])

    run_stage(3, "article_selection — select per KYC customer",
              ["article_selection.py", "--kyc-db"])

    signal_argv = ["signal_extractor.py", "--workers", str(args.workers),
                   "--max-articles", str(args.max_articles)]
    if args.company:
        signal_argv += ["--company", args.company]
    if args.no_brave:
        signal_argv.append("--no-brave")
    run_stage(4, "signal_extractor — screen for KYC drift", signal_argv)

    print(f"\n{'='*64}\nPipeline complete in {time.perf_counter() - overall:.1f}s")
    print("Output: kyc_drift_signals.json")


if __name__ == "__main__":
    main()
