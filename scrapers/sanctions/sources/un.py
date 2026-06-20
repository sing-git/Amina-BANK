"""Parser for the UN Security Council Consolidated Sanctions List's official
XML export (<ENTITIES>/<INDIVIDUALS>), downloaded via
sanctions.download.download_un.

This replaced an earlier version of this module that scraped the UN's
human-readable HTML export instead — that format had no consistent tag
boundaries per field (just bolded labels inside free-flowing text), making
it fragile to parse. This XML export is cleanly structured and is the same
file format used internally by the UN's own sanctions list website.
"""
from __future__ import annotations

from collections.abc import Iterator

from lxml import etree

from scrapers.sanctions.models import SanctionRecord

SOURCE = "UN"
LIST_NAME = "UN Security Council Consolidated List"


def _text(elem, tag: str) -> str | None:
    child = elem.find(tag)
    return child.text if child is not None else None


def _full_name(elem) -> str:
    parts = [
        _text(elem, part)
        for part in ("FIRST_NAME", "SECOND_NAME", "THIRD_NAME", "FOURTH_NAME")
    ]
    return " ".join(p for p in parts if p)


def _aliases(elem) -> list[str]:
    tag = "ENTITY_ALIAS" if elem.tag == "ENTITY" else "INDIVIDUAL_ALIAS"
    return [
        _text(alias, "ALIAS_NAME")
        for alias in elem.findall(tag)
        if _text(alias, "ALIAS_NAME")
    ]


def parse(xml_path: str, entity_types: set[str] | None = None) -> Iterator[SanctionRecord]:
    """Stream-parse the UN Consolidated List XML, yielding one record per
    primary name / alias.

    entity_types: optional filter, e.g. {"Entity"} to only yield companies
    (as opposed to Individuals).
    """
    context = etree.iterparse(xml_path, events=("end",), tag=("ENTITY", "INDIVIDUAL"))
    for _, elem in context:
        try:
            entity_type = "Entity" if elem.tag == "ENTITY" else "Individual"
            if entity_types and entity_type not in entity_types:
                continue

            entity_id = _text(elem, "REFERENCE_NUMBER") or ""
            committee = _text(elem, "UN_LIST_TYPE") or ""
            programs = (committee,) if committee else ()

            primary_name = _full_name(elem)
            if not primary_name:
                continue

            yield SanctionRecord(
                source=SOURCE,
                list_name=LIST_NAME,
                entity_id=entity_id,
                entity_type=entity_type,
                name=primary_name,
                is_primary=True,
                programs=programs,
            )
            for alias in _aliases(elem):
                yield SanctionRecord(
                    source=SOURCE,
                    list_name=LIST_NAME,
                    entity_id=entity_id,
                    entity_type=entity_type,
                    name=alias,
                    is_primary=False,
                    programs=programs,
                )
        finally:
            elem.clear()
            while elem.getprevious() is not None:
                del elem.getparent()[0]
    del context
