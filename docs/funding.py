import json

# ==========================================
# 1. DATABASE LOADER
# ==========================================
def load_internal_database(filepath="docs\kyc_database.json"):
    """Loads company profiles from the local JSON file."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            db = json.load(f)
            print(f"[SUCCESS] Loaded {len(db)} profiles from {filepath}.")
            return db
    except FileNotFoundError:
        print(f"[ERROR] '{filepath}' not found. Ensure it is in the same directory.")
        return []

# ==========================================
# 2. FUNDING EXTRACTOR (CRUNCHBASE / PITCHBOOK MOCK)
# ==========================================
def fetch_crunchbase_data_mock(company_name):
    """
    Simulates a call to Venture Capital databases (Crunchbase, PitchBook, Tracxn).
    """
    print("   -> Routing to: Crunchbase / PitchBook API (Simulation)...")
    
    # Simulating a severe alert for Animoca Brands (Massive unverified funding)
    # and for JPEX (Suspicious offshore funds and critical status)
    mock_responses = {
        "Animoca Brands Corporation Limited": {
            "company_type": "Private",
            "last_known_funding_round": "Series Unknown (Unverified)",
            "total_funding_usd": 1500000000, 
            "known_investors": ["Liberty City Ventures", "Opaque Offshore Trust LLC"] 
        },
        "JPEX Exchange Limited": {
            "company_type": "Closed / Rug Pull", 
            "last_known_funding_round": "Seed",
            "total_funding_usd": 5000000,
            "known_investors": ["Unknown Retail Syndicates"]
        }
    }
    
    # If the company is not in the mock list, we return None (assuming no changes)
    return mock_responses.get(company_name, None) 

# ==========================================
# 3. DRIFT ALGORITHM: FUNDING & CAP TABLE
# ==========================================
def detect_funding_changes(internal_funding_data, live_funding_data):
    """
    Compares internal funding baseline with public startup databases.
    """
    flags = []
    
    if not internal_funding_data or not live_funding_data:
        return flags

    # 1. Alert on critical startup status (e.g., marked as Closed on Crunchbase)
    live_type = live_funding_data.get("company_type", "")
    internal_type = internal_funding_data.get("company_type", "")
    if internal_type != "Public" and live_type in ["Closed", "Closed / Rug Pull", "Liquidated"]:
        flags.append(f"CRITICAL: Startup status on Crunchbase changed to '{live_type}'.")

    # 2. Alert on massive unjustified funding (AML Risk)
    internal_funds = internal_funding_data.get("total_funding_usd")
    live_funds = live_funding_data.get("total_funding_usd")
    
    if internal_funds and live_funds:
        increase_ratio = (live_funds - internal_funds) / internal_funds
        if increase_ratio > 0.30:
            flags.append(f"AML RISK: Massive unexplained funding influx (+{int(increase_ratio*100)}%). Total reached ${live_funds:,}.")

    # 3. Alert on obscure new investors (Governance/Sanctions Risk)
    internal_investors = internal_funding_data.get("known_investors", [])
    live_investors = live_funding_data.get("known_investors", [])
    
    for investor in live_investors:
        if investor not in internal_investors and "Offshore" in investor:
            flags.append(f"GOVERNANCE RISK: Unverified new entity '{investor}' detected in capitalization table.")

    return flags

# ==========================================
# 4. MAIN EXECUTION
# ==========================================
if __name__ == "__main__":
    db = load_internal_database("docs\kyc_database.json")
    
    print("\n" + "="*70)
    print("STARTING FUNDING & VENTURE CAPITAL SCAN (CRUNCHBASE/PITCHBOOK)")
    print("="*70)

    final_report = []

    for target_company in db:
        company_name = target_company.get("legal_name", "Unknown")
        
        # Only analyze companies that have a funding baseline
        if "funding_baseline" not in target_company:
            continue
            
        print(f"\n[INFO] Analyzing venture profile: {company_name}")
        
        live_funding = fetch_crunchbase_data_mock(company_name)
        
        if live_funding:
            funding_alerts = detect_funding_changes(target_company["funding_baseline"], live_funding)
            
            report_entry = {
                "company_id": target_company.get("company_id"),
                "company_name": company_name,
                "status": "FUNDING ANOMALY DETECTED" if funding_alerts else "HEALTHY",
                "negative_alerts": funding_alerts,
                "raw_api_data": live_funding
            }
            final_report.append(report_entry)
            
            if funding_alerts:
                print("   [ALERT] Funding or Cap Table anomaly detected:")
                for alert in funding_alerts:
                    print(f"      - {alert}")
            else:
                print("   [HEALTH CHECK] Cap table and funding rounds align with internal expectations.")
        else:
            print("   [NOTE] No recent funding events or status changes logged on Crunchbase.")

    print("\n" + "="*70)
    print("End of funding scan.")
    
    # Save the dedicated funding report
    output_file = "funding_drift_report.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(final_report, f, indent=4, ensure_ascii=False)
        
    print(f"[SUCCESS] Structured JSON funding report successfully generated: {output_file}")