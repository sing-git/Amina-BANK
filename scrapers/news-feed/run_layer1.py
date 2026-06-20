"""Run Layer 1 — collect all public signals for one or all companies.

Runs two collectors per company, both appending to layer1_signals.json:
  1. layer1_collector.py  — news articles + OpenSanctions check
  2. domain_monitor.py    — HTTP, WHOIS/RDAP, Wayback Machine

Feed layer1_signals.json into Layer 2 (run_layer2.py) for keyword scoring.

Usage:
    python run_layer1.py --all-companies --with-wayback
    python run_layer1.py --company-id CUST-002
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

BASE_DIR    = Path(__file__).resolve().parent
KYC_FILE    = BASE_DIR.parent.parent / "docs" / "kyc_database.json"
OUTPUT_FILE = BASE_DIR / "layer1_signals.json"

_VENV_PY = BASE_DIR.parent.parent / "swisshacks" / "bin" / "python3"
PYTHON = str(_VENV_PY) if _VENV_PY.exists() else sys.executable


def load_company_ids():
    with KYC_FILE.open() as f:
        return [c["company_id"] for c in json.load(f)]


def run_one(label, cmd):
    print(f"\n{'─'*60}\n{label}\n{'─'*60}")
    result = subprocess.run([PYTHON] + cmd, cwd=BASE_DIR)
    if result.returncode != 0:
        print(f"  ⚠  {label} failed — continuing.")
        return False
    return True


def run_company(company_id, with_wayback):
    print(f"\n{'='*60}\n  {company_id}\n{'='*60}")
    run_one(f"News collector — {company_id}",
            ["layer1_collector.py", "--company-id", company_id])

    domain_cmd = ["domain_monitor.py", "--company-id", company_id]
    if not with_wayback:
        domain_cmd.append("--no-wayback")
    run_one(f"Domain monitor — {company_id}", domain_cmd)


def main():
    parser = argparse.ArgumentParser(description="Layer 1 — public signal collection.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--company-id", help="Single company e.g. CUST-002")
    group.add_argument("--all-companies", action="store_true")
    parser.add_argument("--with-wayback", action="store_true",
                        help="Enable Wayback Machine check (slower)")
    args = parser.parse_args()

    if args.all_companies and OUTPUT_FILE.exists():
        OUTPUT_FILE.unlink()
        print("Cleared previous layer1_signals.json")

    company_ids = [args.company_id] if args.company_id else load_company_ids()
    print(f"Layer 1 — collecting signals for {len(company_ids)} "
          f"compan{'y' if len(company_ids) == 1 else 'ies'}")

    for cid in company_ids:
        run_company(cid, args.with_wayback)

    total = 0
    if OUTPUT_FILE.exists():
        with OUTPUT_FILE.open() as f:
            total = len(json.load(f))

    print(f"\n{'='*60}")
    print(f"Layer 1 complete")
    print(f"Companies:        {len(company_ids)}")
    print(f"Raw signals:      {total}")
    print(f"Output:           layer1_signals.json")
    print(f"Next step:        python run_layer2.py")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
