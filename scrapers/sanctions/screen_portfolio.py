"""Bridge: screen every portfolio company against sanctions lists → data/sanctions_hits.json.

Connects Kiara's matcher to the TS pipeline's hard gate. Reads the same KYC database the
pipeline uses, screens each company's legal name + key personnel against OFAC + UN, and
writes the hits in the contract format the TS `sanctionsAdapter` expects.

Run from scrapers/sanctions/:
    python screen_portfolio.py [--threshold 85] [--all-types]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from sanctions import download
from sanctions.cache import load_or_build
from sanctions.matcher import screen
from sanctions.sources import ofac, un

ROOT = Path(__file__).resolve().parents[2]          # repo root
KYC_FILE = ROOT / "data" / "kyc_database.json"
OUT_FILE = ROOT / "data" / "sanctions_hits.json"
MAX_SOURCE_AGE_DAYS = 7


def _ensure_fresh(path: Path, downloader) -> None:
    if path.exists():
        if (time.time() - path.stat().st_mtime) / 86400 <= MAX_SOURCE_AGE_DAYS:
            return
    try:
        downloader(path)
    except OSError as e:
        if not path.exists():
            raise
        print(f"Warning: could not refresh {path} ({e}); using existing copy.", file=sys.stderr)


def load_records(all_types: bool):
    entity_types = None if all_types else {"Entity"}
    records = []
    for dest, parse, dl in (
        (download.OFAC_DEST, ofac.parse, download.download_ofac),
        (download.UN_DEST, un.parse, download.download_un),
    ):
        path = Path(dest)
        _ensure_fresh(path, dl)
        if path.exists():
            records += load_or_build(path, lambda p, parse=parse: parse(str(p), entity_types=entity_types))
        else:
            print(f"source unavailable, skipping: {path}", file=sys.stderr)
    return records


def main() -> int:
    ap = argparse.ArgumentParser(description="Screen the KYC portfolio against sanctions lists.")
    ap.add_argument("--threshold", type=float, default=85.0)
    ap.add_argument("--all-types", action="store_true")
    args = ap.parse_args()

    companies = json.loads(KYC_FILE.read_text(encoding="utf-8"))
    records = load_records(args.all_types)
    if not records:
        print("No sanctions source files available.", file=sys.stderr)
        return 2

    hits = []
    for c in companies:
        names = [c["legal_name"]] + list((c.get("key_personnel") or {}).values())
        for name in names:
            matches = screen(name, records, threshold=args.threshold, limit=1)
            if matches:
                m = matches[0]
                hits.append({
                    "client_id": c["company_id"],
                    "query": name,
                    "matched": True,
                    "matched_entity": m.record.name,
                    "score": round(m.score, 1),
                    "source": m.record.source,
                    "programs": list(m.record.programs),
                })

    OUT_FILE.write_text(json.dumps(hits, indent=2), encoding="utf-8")
    print(f"Wrote {len(hits)} hit(s) → {OUT_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
