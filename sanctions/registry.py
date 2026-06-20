"""Loads every configured sanctions list source, auto-downloading/refreshing
files as needed. Shared by sanctionlist.py and any other script that needs
the combined records (e.g. kyc_sanctions_check.py).
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

from sanctions import download
from sanctions.cache import load_or_build
from sanctions.models import SanctionRecord
from sanctions.sources import ofac, opensanctions, un

MAX_SOURCE_AGE_DAYS = 7

# (label, default file path, downloader, parser) for every configured source.
_SOURCES = [
    ("OFAC", download.OFAC_DEST, download.download_ofac, ofac.parse),
    ("UN", download.UN_DEST, download.download_un, un.parse),
    ("OpenSanctions", download.OPENSANCTIONS_DEST, download.download_opensanctions, opensanctions.parse),
]


def ensure_fresh(path: Path, downloader) -> None:
    """Downloads `path` if missing, or refreshes it if older than
    MAX_SOURCE_AGE_DAYS. Falls back to an existing stale copy (with a
    warning) if the refresh attempt fails, e.g. no internet."""
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


def load_all_records(
    all_types: bool = False,
    overrides: dict[str, Path] | None = None,
) -> list[SanctionRecord]:
    """Returns the combined records from every available sanctions source.
    A source whose file can't be obtained is skipped (with a warning)
    rather than failing the whole load.

    overrides: optional {label: path} to use a custom file location for a
    source instead of its auto-downloaded default, e.g. {"OFAC": Path(...)}.
    """
    entity_types = None if all_types else {"Entity"}
    overrides = overrides or {}
    records: list[SanctionRecord] = []

    for label, default_path, downloader, parser in _SOURCES:
        path = overrides.get(label, default_path)
        ensure_fresh(path, downloader)
        if path.exists():
            records += load_or_build(path, lambda p, parser=parser: parser(str(p), entity_types=entity_types))
        else:
            print(f"{label} source file unavailable, skipping: {path}", file=sys.stderr)

    return records
