"""Streaming parser for OFAC's classic SDN.XML export.

Source: https://www.treasury.gov/ofac/downloads/sdn.xml (downloaded via
sanctions.download.download_ofac). This is OFAC's older, stable bulk export
schema (<sdnEntry>/<akaList>), not the newer "Enhanced XML" format — the
newer format's export button lives behind a JS app with no plain HTTP
download path, so this one is used instead for automatic refreshes. Same
information either way: name, aliases, type, sanctions programs.
"""
#actual sanctionlist reader
from __future__ import annotations

from collections.abc import Iterator

from lxml import etree

from sanctions.models import SanctionRecord

SOURCE = "OFAC"
LIST_NAME = "SDN List"


def _text(elem, tag: str) -> str | None:
    child = elem.find(f"{{*}}{tag}")
    return child.text if child is not None else None


#input: path to the OFAC SDN.XML file, output: iterator of SanctionRecord objects
#output: yields one SanctionRecord for each primary name and alias in the XML file, filtered by entity type if specified. Uses lxml.iterparse for efficient streaming parsing of large XML files.

def parse(xml_path: str, entity_types: set[str] | None = None) -> Iterator[SanctionRecord]:
    """Stream-parse an SDN.XML file, yielding one record per primary name /
    alias.

    entity_types: optional filter, e.g. {"Entity"} to only yield companies
    (as opposed to Individual / Vessel / Aircraft).

    Uses lxml.iterparse with incremental element clearing so the multi-MB
    full export doesn't need to be loaded into memory at once.
    """
    context = etree.iterparse(xml_path, events=("end",), tag="{*}sdnEntry")
    for _, elem in context:
        try:
            entity_id = _text(elem, "uid") or ""
            entity_type = _text(elem, "sdnType")
            if entity_types and entity_type not in entity_types:
                continue

            program_list = elem.find("{*}programList")
            programs = (
                tuple(p.text for p in program_list.findall("{*}program") if p.text)
                if program_list is not None
                else ()
            )

            primary_name = _text(elem, "lastName")
            if primary_name:
                yield SanctionRecord(
                    source=SOURCE,
                    list_name=LIST_NAME,
                    entity_id=entity_id,
                    entity_type=entity_type or "",
                    name=primary_name,
                    is_primary=True,
                    programs=programs,
                )

            aka_list = elem.find("{*}akaList")
            if aka_list is not None:
                for aka in aka_list.findall("{*}aka"):
                    alias_name = _text(aka, "lastName")
                    if alias_name:
                        yield SanctionRecord(
                            source=SOURCE,
                            list_name=LIST_NAME,
                            entity_id=entity_id,
                            entity_type=entity_type or "",
                            name=alias_name,
                            is_primary=False,
                            programs=programs,
                        )
        finally:
            elem.clear()
            while elem.getprevious() is not None:
                del elem.getparent()[0]
    del context
