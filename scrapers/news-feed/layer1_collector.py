"""Layer 1 — News signal collector.

Loads pre-screened news articles from kyc_drift_signals.json, runs an
OpenSanctions check on the company and key personnel, then writes raw signals
(no keyword scoring) to layer1_signals.json.

The keyword scoring, entity matching, and embeddings happen in Layer 2
(keyword_scorer.py).

Usage:
    python layer1_collector.py --company-id CUST-002
    python layer1_collector.py --all-companies
"""

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

BASE_DIR   = Path(__file__).resolve().parent
KYC_FILE   = BASE_DIR.parent.parent / "docs" / "kyc_database.json"
SIGNALS_FILE = BASE_DIR / "kyc_drift_signals.json"
OUTPUT_FILE  = BASE_DIR / "layer1_signals.json"
AUDIT_LOG    = BASE_DIR / "audit_log.jsonl"

OPENSANCTIONS_API = "https://api.opensanctions.org/match/default"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_kyc(company_id=None):
    with KYC_FILE.open() as f:
        db = json.load(f)
    if company_id:
        result = next((c for c in db if c["company_id"] == company_id), None)
        return [result] if result else []
    return db


def load_articles(company_id: str) -> list:
    """Load raw articles from kyc_drift_signals.json for one company."""
    if not SIGNALS_FILE.exists():
        return []
    with SIGNALS_FILE.open() as f:
        data = json.load(f)
    entry = next((c for c in data if c.get("company_id") == company_id), None)
    if not entry:
        return []
    articles = []
    for sig in entry.get("signals", []):
        articles.append({
            "title":       sig.get("title", ""),
            "url":         sig.get("url", ""),
            "published_at":sig.get("published_at", ""),
            "summary":     sig.get("summary", ""),
            "text":        sig.get("full_text", ""),
            "source_feed": sig.get("source", "rss"),
            "companies":   [],
        })
    return articles


def sanctions_lookup(legal_name: str, key_personnel: dict) -> tuple:
    """Check company name and key personnel against OpenSanctions (free API)."""
    names = [legal_name] + list(key_personnel.values())
    matched = []
    for name in names:
        try:
            resp = requests.post(
                OPENSANCTIONS_API,
                json={"queries": {"q": {"schema": "Thing", "properties": {"name": [name]}}}},
                timeout=8,
            )
            if resp.status_code == 200:
                results = resp.json().get("responses", {}).get("q", {}).get("results", [])
                if results and results[0].get("score", 0) > 0.7:
                    matched.append(name)
        except requests.RequestException:
            pass
    return bool(matched), matched


def write_audit(entry: dict):
    with AUDIT_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


# ---------------------------------------------------------------------------
# Collector
# ---------------------------------------------------------------------------

def collect_company(kyc: dict) -> list:
    company_id   = kyc["company_id"]
    legal_name   = kyc["legal_name"]
    key_personnel = kyc.get("key_personnel", {})
    kyc_baseline  = kyc.get("kyc_baseline", {})

    articles = load_articles(company_id)
    print(f"  [News] {len(articles)} articles loaded from kyc_drift_signals.json")

    print(f"  [Sanctions] Checking OpenSanctions ...")
    is_sanctioned, sanction_matches = sanctions_lookup(legal_name, key_personnel)
    if is_sanctioned:
        print(f"  [Sanctions] ⚠  HIT: {sanction_matches}")
    else:
        print(f"  [Sanctions] ✓  No match")

    signals = []
    for article in articles:
        signal = {
            # Identity
            "company_id":          company_id,
            "legal_name":          legal_name,
            "category":            "news",
            "layer":               1,
            # Article content (used by Layer 2 keyword scorer)
            "title":               article["title"],
            "summary":             article.get("summary", ""),
            "text":                article.get("text", ""),
            "url":                 article.get("url", ""),
            "published_at":        article.get("published_at", ""),
            "source_feed":         article.get("source_feed", "rss"),
            "companies":           article.get("companies", []),
            # Sanctions result (Layer 1 deterministic check)
            "is_sanctioned":       is_sanctioned,
            "sanctions_matches":   sanction_matches,
            # KYC context embedded so Layer 2 doesn't need to reload KYC db
            "kyc_legal_name":      legal_name,
            "kyc_domain":          kyc.get("domain", ""),
            "kyc_key_personnel":   key_personnel,
            "kyc_business_model":  kyc_baseline.get("expected_business_model", ""),
            # Metadata
            "collected_at":        datetime.now(timezone.utc).isoformat(),
        }
        signals.append(signal)
        write_audit({**signal, "stage": "layer1"})

    return signals


def main():
    parser = argparse.ArgumentParser(description="Layer 1 news collector.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--company-id", help="Single company, e.g. CUST-002")
    group.add_argument("--all-companies", action="store_true")
    args = parser.parse_args()

    companies = load_kyc(args.company_id if not args.all_companies else None)
    if not companies:
        print("No companies found.")
        return

    all_signals = []
    for kyc in companies:
        print(f"\n{'='*60}\n  {kyc['company_id']} — {kyc['legal_name']}\n{'='*60}")
        signals = collect_company(kyc)
        all_signals.extend(signals)
        if len(companies) > 1:
            time.sleep(0.5)

    # Append to layer1_signals.json (domain_monitor.py also writes here)
    existing = []
    if OUTPUT_FILE.exists():
        try:
            with OUTPUT_FILE.open() as f:
                existing = json.load(f)
        except Exception:
            existing = []
    with OUTPUT_FILE.open("w") as f:
        json.dump(existing + all_signals, f, indent=2)

    print(f"\nLayer 1 news collection complete.")
    print(f"  Articles collected: {len(all_signals)}")
    print(f"  Output: {OUTPUT_FILE.name}")


if __name__ == "__main__":
    main()
