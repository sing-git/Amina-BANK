"""Cross-references KYC customers and their news-linked entities against the
sanctions lists (OFAC + UN + OpenSanctions).

Two kinds of names get screened:
  1. Each KYC customer's own legal name (docs/kyc_database.json)
  2. Every "linked entity" named in a drift-relevant news article about a
     customer (pipeline/news-feed/kyc_drift_signals.json) — e.g. an acquirer,
     new shareholder, regulator, or partner mentioned in coverage about that
     customer

A sanctions match on either is a strong, explainable risk signal: either the
bank's own customer is sanctioned, or a customer is news-linked to a
sanctioned entity.

Usage:
    python kyc_sanctions_check.py [--threshold 85] [--limit 5]
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from sanctions.matcher import SanctionIndex
from sanctions.registry import load_all_records

PROJECT_ROOT = Path(__file__).resolve().parent.parent
KYC_FILE = PROJECT_ROOT / "docs" / "kyc_database.json"
DRIFT_SIGNALS_FILE = PROJECT_ROOT / "pipeline" / "news-feed" / "kyc_drift_signals.json"
FLAGS_FILE = Path(__file__).resolve().parent / "kyc_sanctions_flags.json"

MAX_CONTEXTS_SHOWN = 3


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def collect_subjects() -> dict[str, dict]:
    """Returns {name: {"kind": ..., "contexts": [...]}} for every KYC company
    and every distinct linked entity found in the drift signals."""
    subjects: dict[str, dict] = {}

    for customer in load_json(KYC_FILE):
        name = (customer.get("legal_name") or "").strip()
        if not name:
            continue
        subjects.setdefault(name, {"kind": "KYC company", "contexts": []})
        subjects[name]["contexts"].append({"company_id": customer.get("company_id", "")})

    if DRIFT_SIGNALS_FILE.exists():
        for entry in load_json(DRIFT_SIGNALS_FILE):
            legal_name = entry.get("legal_name", "")
            for signal in entry.get("signals", []):
                for linked in signal.get("linked_entities", []):
                    name = (linked.get("name") or "").strip()
                    if not name:
                        continue
                    subjects.setdefault(name, {"kind": "Linked entity", "contexts": []})
                    subjects[name]["contexts"].append(
                        {
                            "linked_to": legal_name,
                            "role": linked.get("role", ""),
                            "dimension": signal.get("dimension", ""),
                            "title": signal.get("title", ""),
                            "url": signal.get("url", ""),
                        }
                    )
    return subjects


def print_flag(name: str, info: dict, matches) -> None:
    print(f"[{info['kind']}] {name}")
    contexts = info["contexts"]
    for ctx in contexts[:MAX_CONTEXTS_SHOWN]:
        if info["kind"] == "KYC company":
            print(f"    KYC customer: {ctx['company_id']}")
        else:
            print(f"    linked to: {ctx['linked_to']}  (role: {ctx['role']}, dimension: {ctx['dimension']})")
            print(f"    article: {ctx['title']}  [{ctx['url']}]")
    if len(contexts) > MAX_CONTEXTS_SHOWN:
        print(f"    ... (+{len(contexts) - MAX_CONTEXTS_SHOWN} more occurrence(s))")
    for m in matches:
        r = m.record
        tag = "PRIMARY" if r.is_primary else "ALIAS"
        programs = ", ".join(r.programs) if r.programs else "-"
        print(f"    -> [{m.score:5.1f}] {r.name}  ({tag}, {r.entity_type})")
        print(f"       source={r.source} list={r.list_name} entity_id={r.entity_id} programs={programs}")
    print()


def flag_to_dict(name: str, info: dict, matches) -> dict:
    """Same information as print_flag(), as plain JSON-serializable data
    (full contexts, not capped like the terminal output)."""
    return {
        "name": name,
        "kind": info["kind"],
        "contexts": info["contexts"],
        "matches": [
            {
                "score": round(m.score, 1),
                "matched_name": m.record.name,
                "is_primary": m.record.is_primary,
                "entity_type": m.record.entity_type,
                "source": m.record.source,
                "list_name": m.record.list_name,
                "entity_id": m.record.entity_id,
                "programs": list(m.record.programs),
            }
            for m in matches
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Screen KYC customers + their news-linked entities against sanctions lists."
    )
    parser.add_argument("--threshold", type=float, default=85.0, help="Minimum fuzzy match score (0-100)")
    parser.add_argument("--limit", type=int, default=5, help="Max sanctions matches shown per flagged name")
    args = parser.parse_args()

    subjects = collect_subjects()
    n_kyc = sum(1 for s in subjects.values() if s["kind"] == "KYC company")
    n_linked = sum(1 for s in subjects.values() if s["kind"] == "Linked entity")
    print(f"Screening {len(subjects)} names: {n_kyc} KYC companies, {n_linked} linked entities.\n")

    records = load_all_records()
    if not records:
        print("No sanctions list source files available.")
        return 2
    index = SanctionIndex(records)

    flags = []
    for name, info in subjects.items():
        matches = index.screen(name, threshold=args.threshold, limit=args.limit)
        if not matches:
            continue
        print_flag(name, info, matches)
        flags.append(flag_to_dict(name, info, matches))

    if not flags:
        print("No sanctions matches found among KYC companies or linked entities.")
    else:
        print(f"{len(flags)} name(s) flagged out of {len(subjects)} screened.")

    # Always (re)write the file, even with an empty flags list, so a clean
    # run doesn't leave a stale alert sitting around from a previous run.
    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "threshold": args.threshold,
        "names_screened": len(subjects),
        "flagged_count": len(flags),
        "flags": flags,
    }
    with FLAGS_FILE.open("w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"\nWrote {len(flags)} flag(s) to {FLAGS_FILE.name}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
