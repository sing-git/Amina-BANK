"""Pickle-backed cache for parsed sanctions records.

Re-parsing a ~100MB XML export on every screening call would dominate
runtime, so each source's records are parsed once and cached, keyed by the
source file's path + size + mtime. Re-downloading a fresh list export
invalidates the cache automatically.
"""
from __future__ import annotations

import hashlib
import pickle
from pathlib import Path

from sanctions.models import SanctionRecord

CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache"


def _cache_key(source_path: Path) -> str:
    stat = source_path.stat()
    digest = hashlib.sha256(f"{source_path}:{stat.st_size}:{stat.st_mtime_ns}".encode()).hexdigest()
    return digest[:16]


def load_or_build(source_path: str | Path, build_fn) -> list[SanctionRecord]:
    """Return cached records for `source_path`, building + caching them via
    `build_fn(source_path) -> Iterable[SanctionRecord]` on a cache miss."""
    source_path = Path(source_path)
    CACHE_DIR.mkdir(exist_ok=True)
    cache_file = CACHE_DIR / f"{source_path.stem}_{_cache_key(source_path)}.pkl"

    if cache_file.exists():
        with cache_file.open("rb") as f:
            return pickle.load(f)

    records = list(build_fn(source_path))
    with cache_file.open("wb") as f:
        pickle.dump(records, f, protocol=pickle.HIGHEST_PROTOCOL)
    return records
