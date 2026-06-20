"""Run Layer 2 — keyword & NLP scoring on Layer 1 signals.

Reads layer1_signals.json (produced by run_layer1.py) and runs
keyword_scorer.py to score news signals. Domain signals are fully scored
by domain_monitor.py and do not pass through this layer.

Output: layer2_output.json

Usage:
    python run_layer2.py
    python run_layer2.py --no-embeddings   # skip sentence-transformer (faster)
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

BASE_DIR    = Path(__file__).resolve().parent
INPUT_FILE  = BASE_DIR / "layer1_signals.json"
OUTPUT_FILE = BASE_DIR / "layer2_output.json"

_VENV_PY = BASE_DIR.parent.parent / "swisshacks" / "bin" / "python3"
PYTHON = str(_VENV_PY) if _VENV_PY.exists() else sys.executable


def main():
    parser = argparse.ArgumentParser(description="Layer 2 — keyword & NLP scoring.")
    parser.add_argument("--no-embeddings", action="store_true",
                        help="Skip sentence-transformer step (faster)")
    args = parser.parse_args()

    if not INPUT_FILE.exists():
        print("layer1_signals.json not found — run run_layer1.py first.")
        return

    with INPUT_FILE.open() as f:
        all_signals = json.load(f)
    news_count = sum(1 for s in all_signals if s.get("category") == "news")
    print(f"Layer 2 — scoring {news_count} news signals from layer1_signals.json")

    cmd = ["keyword_scorer.py"]
    if args.no_embeddings:
        cmd.append("--no-embeddings")

    print(f"\n{'─'*60}\nKeyword scorer\n{'─'*60}")
    result = subprocess.run([PYTHON] + cmd, cwd=BASE_DIR)
    if result.returncode != 0:
        print("  ⚠  Keyword scorer failed.")
        return

    escalated = 0
    if OUTPUT_FILE.exists():
        with OUTPUT_FILE.open() as f:
            data = json.load(f)
        escalated = sum(1 for s in data if s.get("escalate_to_stage2"))

    print(f"\n{'='*60}")
    print(f"Layer 2 complete")
    print(f"News signals scored: {news_count}")
    print(f"Escalated:        {escalated}")
    print(f"Output:           layer2_output.json")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
