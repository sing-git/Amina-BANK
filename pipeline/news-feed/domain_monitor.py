"""Domain and website monitoring for KYC drift detection.

Checks five sources for domain-level signals that indicate structural change:

  1. WHOIS/ICANN      — registrar, owner, nameserver, expiry vs KYC baseline (free)
  2. Wayback Machine  — snapshot history, dormancy gaps, domain revival (free)
  3. SecurityTrails   — historical DNS records (requires SECURITYTRAILS_API_KEY)
  4. Firecrawl        — current website content vs KYC baseline (requires FIRECRAWL_API_KEY)
  5. Diffbot          — structured page extraction (requires DIFFBOT_TOKEN)

Free sources run always. API-gated sources are skipped unless the key is set in env.
All signals are written to audit_log.jsonl and domain_signals.json.

Usage:
    python domain_monitor.py --company-id CUST-002
    python domain_monitor.py --all-companies
    python domain_monitor.py --company-id CUST-002 --no-wayback  # skip Wayback (slow)
"""

import argparse
import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

BASE_DIR = Path(__file__).resolve().parent
KYC_FILE = BASE_DIR.parent.parent / "docs" / "kyc_database.json"
OUTPUT_FILE = BASE_DIR / "stage1_output.json"
AUDIT_LOG = BASE_DIR / "audit_log.jsonl"

# ---------------------------------------------------------------------------
# Signal type scores — same tier system as stage_scorer.py
# ---------------------------------------------------------------------------
DOMAIN_SIGNAL_SCORES = {
    "DOMAIN_EXPIRED":            0.85,
    "DOMAIN_UNREACHABLE":        0.80,
    "DOMAIN_UNEXPECTED_REDIRECT":0.75,
    "DOMAIN_OWNER_CHANGE":       0.75,
    "DOMAIN_REGISTRAR_CHANGE":   0.65,
    "DOMAIN_NAMESERVER_CHANGE":  0.60,
    "DOMAIN_REVIVAL":            0.58,
    "DOMAIN_DORMANCY_GAP":       0.55,
    "CONTENT_SIGNIFICANT_CHANGE":0.55,
    "DNS_RECORD_CHANGE":         0.52,
    "DOMAIN_EXPIRY_SOON":        0.50,
    "DOMAIN_RECENTLY_CREATED":   0.48,
    "DOMAIN_NO_SNAPSHOTS":       0.40,
}

ESCALATION_THRESHOLD = 0.40

# Wayback: gap larger than this = dormancy signal
DORMANCY_GAP_DAYS = 180

# Domain expiry warning window
EXPIRY_WARNING_DAYS = 60


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


def save_baseline(company_id: str, updates: dict):
    """Persist domain baseline fields to KYC database for future drift comparison."""
    with KYC_FILE.open() as f:
        db = json.load(f)
    for company in db:
        if company["company_id"] == company_id:
            company["kyc_baseline"].update(updates)
            break
    with KYC_FILE.open("w") as f:
        json.dump(db, f, indent=2)


# ---------------------------------------------------------------------------
# 0. HTTP LIVE CHECK — no baseline needed, works on first run
# ---------------------------------------------------------------------------

def run_http_check(company_id, legal_name, domain, kyc_baseline):
    """Check if domain is reachable, detect unexpected redirects."""
    signals = []
    print(f"  [HTTP] Checking https://{domain} ...")

    stored_redirect = kyc_baseline.get("domain_redirect_destination")

    try:
        resp = requests.get(
            f"https://{domain}",
            timeout=10,
            allow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0"},
        )
        final_url = resp.url
        status = resp.status_code

        # Extract final domain from URL
        from urllib.parse import urlparse
        final_domain = urlparse(final_url).netloc.lower().lstrip("www.")
        original_domain = domain.lower().lstrip("www.")

        print(f"  [HTTP] Status: {status} | Final URL: {final_url[:80]}")

        # Domain redirects away to a completely different domain
        if final_domain and original_domain not in final_domain and final_domain not in original_domain:
            if stored_redirect and stored_redirect.lower() in final_domain:
                print(f"  [HTTP] Redirect to '{final_domain}' matches stored baseline — no signal")
            else:
                signals.append(make_signal(
                    company_id, legal_name, domain,
                    "DOMAIN_UNEXPECTED_REDIRECT",
                    f"Domain {domain} now redirects to {final_domain} — possible entity change or acquisition",
                    {
                        "original_domain": domain,
                        "redirect_destination": final_domain,
                        "final_url": final_url,
                        "http_status": status,
                        "stored_redirect": stored_redirect,
                    },
                    source="http",
                ))
                # Save new redirect as baseline for future runs
                save_baseline(company_id, {"domain_redirect_destination": final_domain})

        elif status >= 400:
            signals.append(make_signal(
                company_id, legal_name, domain,
                "DOMAIN_UNREACHABLE",
                f"Domain {domain} returned HTTP {status} — site may be down or seized",
                {"http_status": status, "final_url": final_url},
                source="http",
            ))

    except requests.exceptions.SSLError:
        signals.append(make_signal(
            company_id, legal_name, domain,
            "DOMAIN_UNREACHABLE",
            f"SSL certificate error on {domain} — certificate may be expired or invalid",
            {"error": "ssl_error"},
            source="http",
        ))
    except requests.exceptions.ConnectionError:
        signals.append(make_signal(
            company_id, legal_name, domain,
            "DOMAIN_UNREACHABLE",
            f"Domain {domain} is unreachable — connection refused or DNS failure",
            {"error": "connection_error"},
            source="http",
        ))
    except Exception as e:
        print(f"  [HTTP] Failed: {e}")

    if not signals:
        print(f"  [HTTP] Domain reachable, no redirect anomaly")
    return signals


def write_audit(entry: dict):
    with AUDIT_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def make_signal(company_id, legal_name, domain, signal_type, summary, details=None, source="whois"):
    score = DOMAIN_SIGNAL_SCORES.get(signal_type, 0.40)
    entry = {
        "company_id": company_id,
        "legal_name": legal_name,
        "domain": domain,
        "signal_type": signal_type,
        "risk_score": score,
        "category": "domain",
        "source": source,
        "summary": summary,
        "details": details or {},
        "escalate_to_stage2": score >= ESCALATION_THRESHOLD,
        "stage": 1,
        "cost_usd": 0.0,
        "scored_at": datetime.now(timezone.utc).isoformat(),
    }
    write_audit(entry)
    return entry


# Privacy proxy organisations — registrant hidden behind these = suspicious for corporates
WHOIS_PRIVACY_PROXIES = {
    "domains by proxy", "whoisguard", "perfect privacy", "privacy protect",
    "contact privacy", "registrant privacy", "private registration",
    "withheld for privacy", "redacted for privacy", "data protected",
    "identity protection", "proxy protection", "domain privacy",
}

# Domain status codes that indicate legal hold / enforcement action
LEGAL_HOLD_STATUSES = {
    "clientrenewprohibited", "serverrenewprohibited",
    "clienttransferprohibited", "servertransferprohibited",
    "clientdeleteprohibited", "serverdeleteprohibited",
    "clienthold", "serverhold",
}


def _rdap_lookup(domain):
    """Fallback to RDAP API when python-whois returns empty (newer TLDs, ccTLDs)."""
    try:
        resp = requests.get(f"https://rdap.org/domain/{domain}", timeout=10)
        if resp.status_code != 200:
            return {}
        data = resp.json()
        result = {}

        # Expiry / created dates
        for event in data.get("events", []):
            action = event.get("eventAction", "")
            date_str = event.get("eventDate", "")
            if "expiration" in action:
                result["expiry"] = date_str
            elif "registration" in action:
                result["created"] = date_str

        # Registrar
        for entity in data.get("entities", []):
            roles = entity.get("roles", [])
            vcard = entity.get("vcardArray", [None, []])[1]
            name = next((v[3] for v in vcard if v[0] == "fn"), None) if vcard else None
            if "registrar" in roles and name:
                result["registrar"] = name
            if "registrant" in roles and name:
                result["org"] = name

        # Status
        result["status"] = data.get("status", [])
        result["nameservers"] = [
            ns.get("ldhName", "").lower()
            for ns in data.get("nameservers", [])
        ]
        return result
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# 1. WHOIS / ICANN  (with RDAP fallback)
# ---------------------------------------------------------------------------

def run_whois(company_id, legal_name, domain, kyc_baseline):
    signals = []
    now = datetime.now(timezone.utc)

    # Try python-whois first, fall back to RDAP if data is empty
    whois_data = {}
    try:
        import whois
        print(f"  [WHOIS] Querying {domain} ...")
        w = whois.whois(domain)
        whois_data = {
            "expiry":       w.expiration_date[0] if isinstance(w.expiration_date, list) else w.expiration_date,
            "created":      w.creation_date[0]   if isinstance(w.creation_date, list)   else w.creation_date,
            "registrar":    w.registrar,
            "org":          w.org or (w.registrant if isinstance(w.registrant, str) else None),
            "nameservers":  [ns.lower() for ns in (w.name_servers or [])],
            "status":       w.status if isinstance(w.status, list) else ([w.status] if w.status else []),
        }
    except Exception as e:
        print(f"  [WHOIS] python-whois failed ({e}), trying RDAP ...")

    # Fall back to RDAP if WHOIS returned empty
    if not any([whois_data.get("registrar"), whois_data.get("expiry"), whois_data.get("created")]):
        print(f"  [WHOIS] Falling back to RDAP for {domain} ...")
        rdap = _rdap_lookup(domain)
        if rdap:
            def parse_date(s):
                if not s:
                    return None
                try:
                    return datetime.fromisoformat(s.replace("Z", "+00:00"))
                except Exception:
                    return None
            whois_data = {
                "expiry":      parse_date(rdap.get("expiry")),
                "created":     parse_date(rdap.get("created")),
                "registrar":   rdap.get("registrar"),
                "org":         rdap.get("org"),
                "nameservers": rdap.get("nameservers", []),
                "status":      rdap.get("status", []),
            }

    expiry      = whois_data.get("expiry")
    created     = whois_data.get("created")
    registrar   = whois_data.get("registrar")
    org         = whois_data.get("org")
    nameservers = whois_data.get("nameservers", [])
    statuses    = [s.lower() for s in whois_data.get("status", [])]

    print(f"  [WHOIS] Registrar: {registrar} | Expiry: {expiry} | Org: {org}")

    # --- Expiry ---
    if expiry:
        if not expiry.tzinfo:
            expiry = expiry.replace(tzinfo=timezone.utc)
        if expiry < now:
            signals.append(make_signal(
                company_id, legal_name, domain, "DOMAIN_EXPIRED",
                f"Domain {domain} expired on {expiry.date()}",
                {"expiry_date": expiry.isoformat()},
            ))
        elif expiry < now + timedelta(days=EXPIRY_WARNING_DAYS):
            signals.append(make_signal(
                company_id, legal_name, domain, "DOMAIN_EXPIRY_SOON",
                f"Domain {domain} expires in {(expiry - now).days} days ({expiry.date()})",
                {"expiry_date": expiry.isoformat(), "days_remaining": (expiry - now).days},
            ))

    # --- Recently created ---
    if created:
        if not created.tzinfo:
            created = created.replace(tzinfo=timezone.utc)
        age_days = (now - created).days
        if age_days < 365:
            signals.append(make_signal(
                company_id, legal_name, domain, "DOMAIN_RECENTLY_CREATED",
                f"Domain {domain} created only {age_days} days ago — inconsistent with established company",
                {"created_date": created.isoformat(), "age_days": age_days},
            ))

    # --- WHOIS privacy proxy — suspicious for a corporate client ---
    if org and any(proxy in org.lower() for proxy in WHOIS_PRIVACY_PROXIES):
        signals.append(make_signal(
            company_id, legal_name, domain, "DOMAIN_OWNER_CHANGE",
            f"Domain {domain} registrant is hidden behind privacy proxy '{org}' — corporate clients should have public registration",
            {"registrant_org": org, "flag": "whois_privacy_proxy"},
        ))

    # --- Legal hold / enforcement status codes ---
    active_holds = [s for s in statuses if any(hold in s for hold in LEGAL_HOLD_STATUSES)]
    if active_holds:
        signals.append(make_signal(
            company_id, legal_name, domain, "DOMAIN_OWNER_CHANGE",
            f"Domain {domain} has legal hold status codes: {active_holds} — may indicate enforcement or dispute",
            {"status_codes": active_holds, "flag": "legal_hold"},
        ))

    # --- Registrar change vs KYC baseline ---
    stored_registrar = kyc_baseline.get("domain_registrar")
    if registrar and stored_registrar and stored_registrar.lower() not in registrar.lower():
        signals.append(make_signal(
            company_id, legal_name, domain, "DOMAIN_REGISTRAR_CHANGE",
            f"Registrar changed: was '{stored_registrar}', now '{registrar}'",
            {"previous_registrar": stored_registrar, "current_registrar": registrar},
        ))

    # --- Nameserver change vs KYC baseline ---
    stored_ns = kyc_baseline.get("domain_nameservers", [])
    if nameservers and stored_ns:
        if set(nameservers) != set(ns.lower() for ns in stored_ns):
            signals.append(make_signal(
                company_id, legal_name, domain, "DOMAIN_NAMESERVER_CHANGE",
                f"Nameservers changed for {domain}",
                {"previous": list(stored_ns), "current": nameservers},
            ))

    # --- Owner change vs KYC baseline ---
    stored_org = kyc_baseline.get("domain_registrant_org")
    if org and stored_org and stored_org.lower() not in org.lower():
        signals.append(make_signal(
            company_id, legal_name, domain, "DOMAIN_OWNER_CHANGE",
            f"Registrant org changed: was '{stored_org}', now '{org}'",
            {"previous_org": stored_org, "current_org": org},
        ))

    # Seed baseline on first run for any field not yet stored
    new_baseline = {}
    if registrar and not stored_registrar:
        new_baseline["domain_registrar"] = registrar
    if nameservers and not stored_ns:
        new_baseline["domain_nameservers"] = nameservers
    if org and not stored_org:
        new_baseline["domain_registrant_org"] = org
    if new_baseline:
        save_baseline(company_id, new_baseline)
        print(f"  [WHOIS] Seeded baseline: {list(new_baseline.keys())}")

    if not signals:
        print(f"  [WHOIS] No drift signals detected")
    return signals


# ---------------------------------------------------------------------------
# 2. WAYBACK MACHINE (Internet Archive CDX API — free, no key)
# ---------------------------------------------------------------------------

def run_wayback(company_id, legal_name, domain, run=True):
    signals = []
    if not run:
        print(f"  [Wayback] Skipped")
        return signals

    print(f"  [Wayback] Querying snapshot history for {domain} ...")
    cdx_url = (
        f"http://web.archive.org/cdx/search/cdx"
        f"?url={domain}&output=json&fl=timestamp,statuscode"
        f"&collapse=timestamp:6&limit=200&filter=statuscode:200"
    )
    try:
        resp = requests.get(cdx_url, timeout=15)
        resp.raise_for_status()
        rows = resp.json()
    except Exception as e:
        print(f"  [Wayback] Failed: {e}")
        return signals

    # First row is the header ["timestamp","statuscode"]
    snapshots = rows[1:] if rows else []
    print(f"  [Wayback] Found {len(snapshots)} snapshots")

    if not snapshots:
        signals.append(make_signal(
            company_id, legal_name, domain,
            "DOMAIN_NO_SNAPSHOTS",
            f"No Wayback Machine snapshots found for {domain} — domain may be brand new or never public",
            {"snapshot_count": 0},
            source="wayback",
        ))
        return signals

    # Parse timestamps (format: YYYYMMDDHHmmss)
    def parse_ts(ts):
        return datetime.strptime(ts[:14], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)

    dates = sorted([parse_ts(s[0]) for s in snapshots])
    first_snapshot = dates[0]
    last_snapshot = dates[-1]
    now = datetime.now(timezone.utc)

    # --- Dormancy gap: find largest gap between consecutive snapshots ---
    max_gap_days = 0
    gap_start = gap_end = None
    for i in range(1, len(dates)):
        gap = (dates[i] - dates[i - 1]).days
        if gap > max_gap_days:
            max_gap_days = gap
            gap_start = dates[i - 1]
            gap_end = dates[i]

    if max_gap_days >= DORMANCY_GAP_DAYS:
        signals.append(make_signal(
            company_id, legal_name, domain,
            "DOMAIN_DORMANCY_GAP",
            f"Domain {domain} went dark for {max_gap_days} days ({gap_start.date()} → {gap_end.date()})",
            {
                "gap_days": max_gap_days,
                "gap_start": gap_start.isoformat(),
                "gap_end": gap_end.isoformat(),
                "total_snapshots": len(snapshots),
            },
            source="wayback",
        ))

    # --- Revival: dormant for >180 days then suddenly active again ---
    recent_gap = (now - last_snapshot).days
    if max_gap_days >= DORMANCY_GAP_DAYS and recent_gap < 90:
        signals.append(make_signal(
            company_id, legal_name, domain,
            "DOMAIN_REVIVAL",
            f"Domain {domain} was dormant for {max_gap_days} days but has recent activity (last snapshot: {last_snapshot.date()})",
            {
                "dormancy_gap_days": max_gap_days,
                "last_snapshot": last_snapshot.isoformat(),
                "days_since_last_snapshot": recent_gap,
            },
            source="wayback",
        ))

    print(f"  [Wayback] First: {first_snapshot.date()} | Last: {last_snapshot.date()} | Max gap: {max_gap_days}d")
    if not signals:
        print(f"  [Wayback] No drift signals detected")
    return signals


# ---------------------------------------------------------------------------
# 3. SECURITYTRAILS (historical DNS — requires API key)
# ---------------------------------------------------------------------------

def run_securitytrails(company_id, legal_name, domain):
    signals = []
    api_key = os.environ.get("SECURITYTRAILS_API_KEY")
    if not api_key:
        print(f"  [SecurityTrails] Skipped — set SECURITYTRAILS_API_KEY to enable")
        return signals

    print(f"  [SecurityTrails] Querying DNS history for {domain} ...")
    headers = {"apikey": api_key, "Accept": "application/json"}

    for record_type in ["A", "MX", "NS"]:
        try:
            resp = requests.get(
                f"https://api.securitytrails.com/v1/history/{domain}/dns/{record_type.lower()}",
                headers=headers,
                timeout=10,
            )
            if resp.status_code == 200:
                data = resp.json()
                records = data.get("records", [])
                if len(records) > 1:
                    # Multiple historical records = DNS changed over time
                    first = records[-1]
                    latest = records[0]
                    first_vals = set(v.get("ip", v.get("host", "")) for v in first.get("values", []))
                    latest_vals = set(v.get("ip", v.get("host", "")) for v in latest.get("values", []))
                    if first_vals != latest_vals:
                        signals.append(make_signal(
                            company_id, legal_name, domain,
                            "DNS_RECORD_CHANGE",
                            f"{record_type} records changed for {domain}: {first_vals} → {latest_vals}",
                            {
                                "record_type": record_type,
                                "previous_values": list(first_vals),
                                "current_values": list(latest_vals),
                                "change_count": len(records),
                            },
                            source="securitytrails",
                        ))
            elif resp.status_code == 429:
                print(f"  [SecurityTrails] Rate limited")
                break
        except Exception as e:
            print(f"  [SecurityTrails] {record_type} query failed: {e}")

    if not signals:
        print(f"  [SecurityTrails] No DNS changes detected")
    return signals


# ---------------------------------------------------------------------------
# 4. FIRECRAWL (website content vs KYC baseline — requires API key)
# ---------------------------------------------------------------------------

def run_firecrawl(company_id, legal_name, domain, kyc_baseline):
    signals = []
    api_key = os.environ.get("FIRECRAWL_API_KEY")
    if not api_key:
        print(f"  [Firecrawl] Skipped — set FIRECRAWL_API_KEY to enable")
        return signals

    print(f"  [Firecrawl] Scraping https://{domain} ...")
    try:
        resp = requests.post(
            "https://api.firecrawl.dev/v1/scrape",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"url": f"https://{domain}", "formats": ["markdown"], "onlyMainContent": True},
            timeout=30,
        )
        if resp.status_code != 200:
            print(f"  [Firecrawl] HTTP {resp.status_code}")
            return signals

        content = resp.json().get("data", {}).get("markdown", "")
        if not content:
            return signals

        # Compare current content against KYC baseline business model using keywords
        baseline = kyc_baseline.get("expected_business_model", "").lower()
        content_lower = content.lower()

        baseline_keywords = set(baseline.split()) - {"and", "or", "the", "of", "in", "for", "a", "an"}
        content_keywords = set(content_lower.split())

        overlap = baseline_keywords & content_keywords
        overlap_ratio = len(overlap) / max(len(baseline_keywords), 1)

        print(f"  [Firecrawl] Content scraped ({len(content)} chars) | Baseline overlap: {overlap_ratio:.0%}")

        if overlap_ratio < 0.25:
            signals.append(make_signal(
                company_id, legal_name, domain,
                "CONTENT_SIGNIFICANT_CHANGE",
                f"Website content for {domain} has low overlap ({overlap_ratio:.0%}) with KYC baseline business model",
                {
                    "baseline_overlap_ratio": round(overlap_ratio, 3),
                    "baseline_keywords_matched": list(overlap)[:10],
                    "content_length_chars": len(content),
                },
                source="firecrawl",
            ))

    except Exception as e:
        print(f"  [Firecrawl] Failed: {e}")

    if not signals:
        print(f"  [Firecrawl] No significant content drift detected")
    return signals


# ---------------------------------------------------------------------------
# 5. DIFFBOT (structured extraction — requires token)
# ---------------------------------------------------------------------------

def run_diffbot(company_id, legal_name, domain, kyc_baseline):
    signals = []
    token = os.environ.get("DIFFBOT_TOKEN")
    if not token:
        print(f"  [Diffbot] Skipped — set DIFFBOT_TOKEN to enable")
        return signals

    print(f"  [Diffbot] Extracting structured data from https://{domain} ...")
    try:
        resp = requests.get(
            "https://api.diffbot.com/v3/analyze",
            params={"url": f"https://{domain}", "token": token},
            timeout=20,
        )
        if resp.status_code != 200:
            print(f"  [Diffbot] HTTP {resp.status_code}")
            return signals

        data = resp.json()
        objects = data.get("objects", [])
        if not objects:
            return signals

        obj = objects[0]
        extracted_type = obj.get("type", "")
        extracted_text = obj.get("text", "") or obj.get("description", "")

        baseline = kyc_baseline.get("expected_business_model", "").lower()
        content_lower = extracted_text.lower()

        baseline_keywords = set(baseline.split()) - {"and", "or", "the", "of", "in", "for", "a", "an"}
        content_keywords = set(content_lower.split())
        overlap_ratio = len(baseline_keywords & content_keywords) / max(len(baseline_keywords), 1)

        print(f"  [Diffbot] Page type: {extracted_type} | Baseline overlap: {overlap_ratio:.0%}")

        if overlap_ratio < 0.25:
            signals.append(make_signal(
                company_id, legal_name, domain,
                "CONTENT_SIGNIFICANT_CHANGE",
                f"Diffbot structured extraction for {domain} shows low baseline overlap ({overlap_ratio:.0%})",
                {
                    "page_type": extracted_type,
                    "baseline_overlap_ratio": round(overlap_ratio, 3),
                },
                source="diffbot",
            ))

    except Exception as e:
        print(f"  [Diffbot] Failed: {e}")

    if not signals:
        print(f"  [Diffbot] No significant content drift detected")
    return signals


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def check_company(kyc: dict, run_wayback_flag: bool) -> list:
    company_id = kyc["company_id"]
    legal_name = kyc["legal_name"]
    domain = kyc.get("domain", "")
    kyc_baseline = kyc.get("kyc_baseline", {})

    if not domain:
        print(f"  No domain configured for {legal_name} — skipping")
        return []

    print(f"\n{'='*64}")
    print(f"{legal_name} ({company_id}) — {domain}")
    print(f"{'='*64}")

    all_signals = []
    all_signals += run_http_check(company_id, legal_name, domain, kyc_baseline)
    all_signals += run_whois(company_id, legal_name, domain, kyc_baseline)
    all_signals += run_wayback(company_id, legal_name, domain, run=run_wayback_flag)
    all_signals += run_securitytrails(company_id, legal_name, domain)
    all_signals += run_firecrawl(company_id, legal_name, domain, kyc_baseline)
    all_signals += run_diffbot(company_id, legal_name, domain, kyc_baseline)

    escalated = [s for s in all_signals if s["escalate_to_stage2"]]
    print(f"\n  Signals found:   {len(all_signals)}")
    print(f"  → Stage 2:       {len(escalated)} escalated")
    for s in escalated:
        print(f"    [{s['risk_score']:.2f}] {s['signal_type']:<30} {s['summary'][:60]}")

    return all_signals


def main():
    parser = argparse.ArgumentParser(description="Domain and website monitoring for KYC drift.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--company-id", help="Single company, e.g. CUST-002")
    group.add_argument("--all-companies", action="store_true", help="Run for all KYC companies")
    parser.add_argument("--no-wayback", action="store_true", help="Skip Wayback Machine (faster)")
    args = parser.parse_args()

    companies = load_kyc(None if args.all_companies else args.company_id)
    if not companies:
        print(f"No companies found.")
        return

    run_wayback_flag = not args.no_wayback
    all_signals = []

    for kyc in companies:
        signals = check_company(kyc, run_wayback_flag)
        all_signals.extend(signals)
        if len(companies) > 1:
            time.sleep(1)  # be polite to free APIs

    # Merge with existing stage1_output.json (from stage_scorer.py) if present
    existing = []
    if OUTPUT_FILE.exists():
        try:
            with OUTPUT_FILE.open() as f:
                data = json.load(f)
                existing = data if isinstance(data, list) else data.get("articles", [])
        except (json.JSONDecodeError, OSError):
            existing = []

    merged = existing + all_signals
    with OUTPUT_FILE.open("w") as f:
        json.dump(merged, f, indent=2)

    total_escalated = sum(1 for s in all_signals if s["escalate_to_stage2"])
    print(f"\n{'='*64}")
    print(f"Companies checked:  {len(companies)}")
    print(f"Total signals:      {len(all_signals)}")
    print(f"→ Stage 2:          {total_escalated} escalated")
    print(f"Stage 1 cost:       $0.00")
    print(f"Output:             {OUTPUT_FILE.name}")
    print(f"Audit log:          {AUDIT_LOG.name}")


if __name__ == "__main__":
    main()
