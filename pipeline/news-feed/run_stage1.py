"""Run Stage 1 for one or all companies: news scoring + domain monitoring → stage1_output.json

Usage:
    python run_stage1.py --company-id CUST-002
    python run_stage1.py --all-companies
    python run_stage1.py --all-companies --with-embeddings --with-wayback
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
KYC_FILE = BASE_DIR.parent.parent / "docs" / "kyc_database.json"
OUTPUT_FILE = BASE_DIR / "stage1_output.json"


def load_company_ids():
    with KYC_FILE.open() as f:
        db = json.load(f)
    return [c["company_id"] for c in db]


def run_one(label, cmd):
    print(f"\n{'─'*60}\n{label}\n{'─'*60}")
    result = subprocess.run([sys.executable] + cmd, cwd=BASE_DIR)
    if result.returncode != 0:
        print(f"  ⚠  {label} failed — continuing with next company.")
        return False
    return True


def run_company(company_id, with_embeddings, with_wayback):
    print(f"\n{'='*60}")
    print(f"  {company_id}")
    print(f"{'='*60}")

    scorer_cmd = ["stage_scorer.py", "--company-id", company_id, "--from-signals"]
    if not with_embeddings:
        scorer_cmd.append("--no-embeddings")

    domain_cmd = ["domain_monitor.py", "--company-id", company_id]
    if not with_wayback:
        domain_cmd.append("--no-wayback")

    run_one(f"News scoring — {company_id}", scorer_cmd)
    run_one(f"Domain monitor — {company_id}", domain_cmd)


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--company-id", help="Single company e.g. CUST-002")
    group.add_argument("--all-companies", action="store_true", help="Run for all KYC companies")
    parser.add_argument("--with-embeddings", action="store_true", help="Enable sentence-transformer drift score")
    parser.add_argument("--with-wayback", action="store_true", help="Enable Wayback Machine check (slow)")
    args = parser.parse_args()

    # Clear output file before a full run so we don't accumulate stale signals
    if args.all_companies and OUTPUT_FILE.exists():
        OUTPUT_FILE.unlink()
        print(f"Cleared previous stage1_output.json")

    company_ids = [args.company_id] if args.company_id else load_company_ids()
    print(f"Running Stage 1 for {len(company_ids)} compan{'y' if len(company_ids) == 1 else 'ies'}")

    for company_id in company_ids:
        run_company(company_id, args.with_embeddings, args.with_wayback)

    # Summary
    total_signals = 0
    escalated = 0
    if OUTPUT_FILE.exists():
        with OUTPUT_FILE.open() as f:
            data = json.load(f)
        signals = data if isinstance(data, list) else data.get("articles", [])
        total_signals = len(signals)
        escalated = sum(1 for s in signals if s.get("escalate_to_stage2"))

    print(f"\n{'='*60}")
    print(f"Stage 1 complete")
    print(f"Companies:      {len(company_ids)}")
    print(f"Total signals:  {total_signals}")
    print(f"→ Stage 2:      {escalated} escalated")
    print(f"Output:         stage1_output.json")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
