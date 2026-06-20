"""Sanctions list screening CLI.

Checks a company name against sanctions list data (currently: OFAC SDN List,
UN Security Council Consolidated List). Other sources (EU FSD, OpenSanctions)
plug in the same way: a `sources/<name>.py` loader yielding `SanctionRecord`s,
fed into the same cache + fuzzy matcher.

Source files are fetched automatically (see sanctions/download.py) — nobody
needs to manually download and place them in data/. A local copy older than
MAX_SOURCE_AGE_DAYS is re-downloaded automatically; if that fails (e.g. no
internet), the existing copy is used instead of failing outright.

Usage:
    python sanctionlist.py "Company Name" [--threshold 85] [--limit 10] [--all-types]
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from sanctions import download
from sanctions.cache import load_or_build
from sanctions.matcher import screen
from sanctions.sources import ofac, un

MAX_SOURCE_AGE_DAYS = 7


def _ensure_fresh(path: Path, downloader) -> None:
    if path.exists():
        age_days = (time.time() - path.stat().st_mtime) / 86400
        if age_days <= MAX_SOURCE_AGE_DAYS:
            return
    try:
        downloader(path)
    except OSError as e:
        if not path.exists():
            raise
        print(f"Warning: could not refresh {path} ({e}); using existing copy.", file=sys.stderr)


def load_ofac_records(xml_path: Path, all_types: bool):
    entity_types = None if all_types else {"Entity"}
    return load_or_build(xml_path, lambda p: ofac.parse(str(p), entity_types=entity_types))


def load_un_records(xml_path: Path, all_types: bool):
    entity_types = None if all_types else {"Entity"}
    return load_or_build(xml_path, lambda p: un.parse(str(p), entity_types=entity_types))


def main() -> int:
    parser = argparse.ArgumentParser(description="Screen a company name against sanctions lists.")
    parser.add_argument("name", help="Company name to screen")
    parser.add_argument("--xml", default=None, help="Path to OFAC SDN.XML (default: auto-downloaded)")
    parser.add_argument("--un-xml", default=None, help="Path to UN Consolidated List XML (default: auto-downloaded)")
    parser.add_argument("--threshold", type=float, default=85.0, help="Minimum fuzzy match score (0-100)")
    parser.add_argument("--limit", type=int, default=10, help="Max number of matches to show")
    parser.add_argument(
        "--all-types",
        action="store_true",
        help="Include Individuals/Vessels/Aircraft, not just Entities (companies)",
    )
    args = parser.parse_args()

    records = []

    xml_path = Path(args.xml) if args.xml else download.OFAC_DEST
    _ensure_fresh(xml_path, download.download_ofac)
    if xml_path.exists():
        records += load_ofac_records(xml_path, args.all_types)
    else:
        print(f"OFAC source file unavailable, skipping: {xml_path}", file=sys.stderr)

    un_xml_path = Path(args.un_xml) if args.un_xml else download.UN_DEST
    _ensure_fresh(un_xml_path, download.download_un)
    if un_xml_path.exists():
        records += load_un_records(un_xml_path, args.all_types)
    else:
        print(f"UN source file unavailable, skipping: {un_xml_path}", file=sys.stderr)

    if not records:
        print("No sanctions list source files available.", file=sys.stderr)
        return 2

    matches = screen(args.name, records, threshold=args.threshold, limit=args.limit)

    if not matches:
        print("No match.")
        return 0

    print(f"{len(matches)} match(es) for '{args.name}':\n")
    for m in matches:
        r = m.record
        tag = "PRIMARY" if r.is_primary else "ALIAS"
        programs = ", ".join(r.programs) if r.programs else "-"
        print(f"  [{m.score:5.1f}] {r.name}  ({tag}, {r.entity_type})")
        print(f"           source={r.source} list={r.list_name} entity_id={r.entity_id} programs={programs}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
