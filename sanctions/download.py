"""Fetches fresh copies of the sanctions list source files directly from
the official publishers, so nobody has to manually download and copy files
into `data/` by hand.

Run directly to refresh everything:
    python -m sanctions.download
"""
from __future__ import annotations

import urllib.request
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

# OFAC's modern "Sanctions List Service" UI is a JS app whose export button
# isn't reachable with a plain HTTP request; this older, stable redirect
# (still linked from treasury.gov) resolves to the same SDN data.
OFAC_SDN_URL = "https://www.treasury.gov/ofac/downloads/sdn.xml"
OFAC_DEST = DATA_DIR / "ofac" / "SDN.XML"

# Requires a Referer header from the UN's own site, or the request is
# rejected before the redirect to the actual file (hosted on Azure Blob
# Storage) is issued.
UN_CONSOLIDATED_URL = "https://scsanctions.un.org/resources/xml/en/consolidated.xml"
UN_REFERER = "https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list"
UN_DEST = DATA_DIR / "un" / "consolidated.xml"


def _download(url: str, dest: Path, referer: str | None = None) -> None:
    headers = {"User-Agent": _USER_AGENT}
    if referer:
        headers["Referer"] = referer
    request = urllib.request.Request(url, headers=headers)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(request, timeout=120) as response, dest.open("wb") as out:
        out.write(response.read())


def download_ofac(dest: Path = OFAC_DEST) -> Path:
    _download(OFAC_SDN_URL, dest)
    return dest


def download_un(dest: Path = UN_DEST) -> Path:
    _download(UN_CONSOLIDATED_URL, dest, referer=UN_REFERER)
    return dest


def main() -> int:
    print(f"Downloading OFAC SDN list -> {OFAC_DEST}")
    download_ofac()
    print(f"Downloading UN Consolidated List -> {UN_DEST}")
    download_un()
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
