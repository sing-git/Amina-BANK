"""Sanctions list screening CLI.

Checks a company name against sanctions list data (currently: OFAC SDN List,
UN Security Council Consolidated List, OpenSanctions Consolidated
Sanctions). Other sources plug in the same way: a `sources/<name>.py` loader
yielding `SanctionRecord`s, fed into the same cache + fuzzy matcher.

Source files are fetched automatically (see sanctions/download.py) — nobody
needs to manually download and place them in data/. A local copy older than
sanctions.registry.MAX_SOURCE_AGE_DAYS is re-downloaded automatically; if
that fails (e.g. no internet), the existing copy is used instead of failing
outright.

Usage:
    python sanctionlist.py "Company Name" [--threshold 85] [--limit 10] [--all-types]
"""
from __future__ import annotations

import argparse
from pathlib import Path

from sanctions.matcher import screen
from sanctions.registry import load_all_records


def main() -> int:
    parser = argparse.ArgumentParser(description="Screen a company name against sanctions lists.")
    parser.add_argument("name", help="Company name to screen")
    parser.add_argument("--xml", default=None, help="Path to OFAC SDN.XML (default: auto-downloaded)")
    parser.add_argument("--un-xml", default=None, help="Path to UN Consolidated List XML (default: auto-downloaded)")
    parser.add_argument("--opensanctions-csv", default=None, help="Path to OpenSanctions targets.simple.csv (default: auto-downloaded)")
    parser.add_argument("--threshold", type=float, default=85.0, help="Minimum fuzzy match score (0-100)")
    parser.add_argument("--limit", type=int, default=10, help="Max number of matches to show")
    parser.add_argument(
        "--all-types",
        action="store_true",
        help="Include Individuals/Vessels/Aircraft, not just Entities (companies)",
    )
    args = parser.parse_args()

    overrides = {}
    if args.xml:
        overrides["OFAC"] = Path(args.xml)
    if args.un_xml:
        overrides["UN"] = Path(args.un_xml)
    if args.opensanctions_csv:
        overrides["OpenSanctions"] = Path(args.opensanctions_csv)

    records = load_all_records(all_types=args.all_types, overrides=overrides)

    if not records:
        print("No sanctions list source files available.")
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
