"""Parser for OpenSanctions' "Consolidated Sanctions" bulk export
(targets.simple.csv), downloaded via sanctions.download.download_opensanctions.

OpenSanctions aggregates ~50 national and international sanctions lists (UK
OFSI, EU, Switzerland SECO, Canada, Australia, plus the OFAC and UN data we
already pull directly) into one deduplicated dataset, so adding this source
brings in coverage we don't have dedicated loaders for (notably the EU).

Licensing note: OpenSanctions' bulk data is Creative Commons
Attribution-NonCommercial (CC BY-NC 4.0) — free for non-commercial/research
use, but a business deploying this for real client/transaction screening
would need a commercial license from OpenSanctions.
See https://www.opensanctions.org/licensing/.
"""
from __future__ import annotations

import csv
from collections.abc import Iterator

from scrapers.sanctions.sanctions.models import SanctionRecord

SOURCE = "OpenSanctions"
LIST_NAME = "OpenSanctions Consolidated Sanctions"

# OpenSanctions' own entity-type vocabulary ("schema"), mapped onto the same
# Entity/Individual/Vessel/Aircraft vocabulary the OFAC and UN parsers use,
# so a single entity_types={"Entity"} filter works across all sources.
# CryptoWallet/Security/Address rows have no mapping and are skipped.
_TYPE_MAP = {
    "Person": "Individual",
    "Organization": "Entity",
    "LegalEntity": "Entity",
    "Company": "Entity",
    "PublicBody": "Entity",
    "Vessel": "Vessel",
    "Airplane": "Aircraft",
}


def _split(value: str | None) -> list[str]:
    if not value:
        return []
    return [v.strip() for v in value.split(";") if v.strip()]


def parse(csv_path: str, entity_types: set[str] | None = None) -> Iterator[SanctionRecord]:
    """Parse the OpenSanctions simplified CSV, yielding one record per
    primary name / alias.

    entity_types: optional filter, e.g. {"Entity"} to only yield companies
    (as opposed to Individuals/Vessels/Aircraft/...).
    """
    with open(csv_path, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            entity_type = _TYPE_MAP.get(row.get("schema", ""))
            if entity_type is None:
                continue
            if entity_types and entity_type not in entity_types:
                continue

            primary_name = (row.get("name") or "").strip()
            if not primary_name:
                continue

            entity_id = row.get("id", "")
            programs = tuple(_split(row.get("dataset")))

            yield SanctionRecord(
                source=SOURCE,
                list_name=LIST_NAME,
                entity_id=entity_id,
                entity_type=entity_type,
                name=primary_name,
                is_primary=True,
                programs=programs,
            )
            for alias in _split(row.get("aliases")):
                if alias == primary_name:
                    continue
                yield SanctionRecord(
                    source=SOURCE,
                    list_name=LIST_NAME,
                    entity_id=entity_id,
                    entity_type=entity_type,
                    name=alias,
                    is_primary=False,
                    programs=programs,
                )
