import json
import requests
import urllib.parse
import os
import difflib
from dotenv import load_dotenv

# Charge les variables d'environnement depuis le fichier .env
load_dotenv()

# ==========================================
# 1. CHARGEMENT DE LA BASE INTERNE (LAYER 2)
# ==========================================
def load_internal_database(filepath="docs/kyc_database.json"):
    """Charge les profils d'entreprise depuis ton fichier JSON."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            db = json.load(f)
            print(f"✅ Success : {len(db)} profiles loaded from {filepath}.")
            return db
    except FileNotFoundError:
        print(f"❌ Error : '{filepath}' Not found. Make sure it's in the same folder.")
        return []

# ==========================================
# 2. LES EXTRACTEURS D'API (LAYER 1)
# ==========================================

def fetch_companies_house_data(company_number, api_key):
    """UK Companies House API"""
    print("   -> Routing to: UK Companies House API...")
    url = f"https://api.company-information.service.gov.uk/company/{company_number}"
    
    try:
        response = requests.get(url, auth=(api_key, ''))
        if response.status_code == 200:
            data = response.json()
            
            # Fetch officers (second call)
            officers_url = f"{url}/officers"
            off_res = requests.get(officers_url, auth=(api_key, ''))
            active_directors = []
            if off_res.status_code == 200:
                for off in off_res.json().get("items", []):
                    # Collect ALL active directors
                    if off.get("officer_role") == "director" and "resigned_on" not in off:
                        active_directors.append(off.get("name"))

            # Join all directors into a single large string
            active_ceo = " | ".join(active_directors) if active_directors else "Not listed"

            return {
                "legal_name": data.get("company_name"),
                "company_status": data.get("company_status"),
                "jurisdiction": "UK",
                "legal_form": data.get("type"),
                "ownership": "API UK: Not provided", # Ignored by the algorithm
                "officers": {"CEO": active_ceo}
            }
        else:
            print(f"   [ERROR] UK API returned status: {response.status_code}")
            return None
    except Exception as e:
        print(f"   [ERROR] UK API Exception: {e}")
        return None

def fetch_zefix_data(uid_number):
    """Swiss ZEFIX API"""
    print("   -> Routing to: ZEFIX Registry API...")
    clean_uid = uid_number.replace("CHE-", "").replace(".", "")
    url = f"https://www.zefix.admin.ch/ZefixREST/api/v1/company/uid/{clean_uid}"
    
    try:
        response = requests.get(url)
        if response.status_code == 200:
            data = response.json()
            company = data[0] if isinstance(data, list) else data
            status_text = "Active" if company.get("status") == 1 else "Dissolved"
            
            return {
                "legal_name": company.get("name"),
                "company_status": status_text,
                "jurisdiction": "Switzerland",
                "legal_form": company.get("legalForm", {}).get("name", {}).get("en", "Unknown"),
                "ownership": "API ZEFIX: Not provided",
                "officers": {"CEO": "API ZEFIX: Not provided"}
            }
        return None
    except Exception as e:
        print(f"   [ERROR] ZEFIX API Exception: {e}")
        return None

def fetch_gleif_data(company_name):
    """Global GLEIF API (Fallback)"""
    print("   -> Routing to: GLEIF LEI Database API...")
    safe_name = urllib.parse.quote(company_name)
    url = f"https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]={safe_name}"
    
    try:
        response = requests.get(url)
        if response.status_code == 200:
            data = response.json()
            if not data.get("data"):
                return None
                
            entity = data["data"][0]["attributes"]["entity"]
            raw_jur = entity.get("jurisdiction", "Unknown")
            country_code = raw_jur.split('-')[0] if '-' in raw_jur else raw_jur
            
            return {
                "legal_name": entity.get("legalName", {}).get("name", "Unknown"),
                "company_status": entity.get("status", "Unknown"),
                "jurisdiction": country_code, 
                "legal_form": entity.get("legalForm", {}).get("name", "Unknown"),
                "ownership": "API GLEIF: Not provided",
                "officers": {"CEO": "API GLEIF: Not provided"}
            }
        return None
    except Exception as e:
        print(f"   [ERROR] GLEIF API Exception: {e}")
        return None

def fetch_acra_singapore_mock():
    """ACRA Singapore API (Hackathon Simulation)"""
    print("   -> Routing to: ACRA Singapore API (Simulation)...")
    # Simulates the Singapore API returning dissolved status for Terraform
    return {
        "legal_name": "Terraform Labs",
        "company_status": "Dissolved", # Triggers Critical Alert!
        "jurisdiction": "Singapore",
        "legal_form": "Private Limited Company",
        "ownership": "API ACRA: Not provided",
        "officers": {"CEO": "Unknown"} # Triggers Officer Change Alert!
    }

# ==========================================
# 3. SMART ROUTER
# ==========================================
def route_and_fetch(target_company, api_keys):
    """Analyzes the company and routes to the correct API."""
    name = target_company.get("legal_name", "")
    jurisdiction = target_company.get("jurisdiction", "").upper()
    
    # Mapping real IDs for specific registries (UK/CH)
    company_ids = {
        "Revolut Ltd": "08804411",         # UK Companies House Number
        "Novartis AG": "CHE-103.867.266",  # Swiss UID Example
        "CryptoSwiss GmbH": "CHE-123.456.789"
    }

    if jurisdiction == "UK" and name in company_ids:
        return fetch_companies_house_data(company_ids[name], api_keys.get("uk_companies_house"))
        
    elif jurisdiction in ["SWITZERLAND", "CH"] and name in company_ids:
        return fetch_zefix_data(company_ids[name])
        
    elif name == "Terraform Labs":
        # Hackathon Trick: Route Terraform Labs to our simulated Singapore API
        return fetch_acra_singapore_mock()
        
    else:
        # Global Fallback (USA, etc.) -> GLEIF
        return fetch_gleif_data(name)

# ==========================================
# 4. KYC DRIFT ALGORITHM
# ==========================================
def detect_registry_changes(internal_data, live_data):
    """Securely compares internal data with live registry data."""
    flags = []
    warnings = [] # To store missing API info warnings
    
    # 1. Company Name
    if internal_data.get("legal_name", "").lower() not in live_data.get("legal_name", "").lower():
        flags.append(f"Entity Identity Change: '{internal_data.get('legal_name')}' -> '{live_data.get('legal_name')}'")
        
    # 2. Status
    live_status = live_data.get("company_status", "Active").lower()
    if live_status not in ["active", "normal", "unknown"]: 
        if internal_data.get("company_status", "Active").lower() != live_status:
            flags.append(f"Critical Status Change: -> '{live_status.upper()}'")
            
    # 3. Jurisdiction
    if internal_data.get("jurisdiction", "").lower() != live_data.get("jurisdiction", "").lower():
        flags.append(f"Jurisdiction Moved: '{internal_data.get('jurisdiction')}' -> '{live_data.get('jurisdiction')}'")

    # 4. Personnel (Only if the API supports it)
    internal_personnel = internal_data.get("key_personnel", {})
    live_personnel = live_data.get("officers", {})
    
    for role, internal_name in internal_personnel.items():
        if role not in live_personnel:
            continue

        live_name = live_personnel.get(role, "")
        
        # Store missing info as warnings instead of silent ignores
        if "API" in live_name or "Not provided" in live_name:
            warnings.append(f"Source data missing: {role} not tracked by this API.")
            continue
            
        if not live_name or live_name == "Not listed":
            flags.append(f"{role} removed: {internal_name} is no longer listed")
        else:
            # Fuzzy Matching (Typo tolerance)
            name_parts = internal_name.lower().split()
            live_words = live_name.lower().replace(',', '').replace('|', '').split()
            
            is_match = True
            for part in name_parts:
                close_matches = difflib.get_close_matches(part, live_words, n=1, cutoff=0.8)
                if part not in live_name.lower() and not close_matches:
                    is_match = False
                    break
                    
            if not is_match:
                flags.append(f"{role} changed: '{internal_name}' -> Not found in [{live_name}]")
            
    return flags, warnings

# ==========================================
# 5. MAIN EXECUTION
# ==========================================
if __name__ == "__main__":
    # Securely retrieve the key from the .env file
    API_KEYS = {
        "uk_companies_house": os.getenv("UK_API_KEY") 
    }
    
    if not API_KEYS["uk_companies_house"]:
        print("[WARNING] UK_API_KEY was not found in the .env file!")
    
    db = load_internal_database("docs\kyc_database.json")
    
    print("\n" + "="*60)
    print("STARTING KYC DRIFT SCAN (MULTI-SOURCE LIVE)")
    print("="*60)

    # Initialize the list for the final JSON report
    final_report = []

    for target_company in db:
        company_name = target_company.get("legal_name", "Unknown")
        print(f"\n[INFO] Analyzing entity: {company_name}")
        
        # 1. Routing and extraction
        live_registry = route_and_fetch(target_company, API_KEYS)
        
        # 2. Analysis and Result
        if live_registry:
            detected_changes, warnings = detect_registry_changes(target_company, live_registry)
            
            # Build the JSON block for this company
            report_entry = {
                "company_name": company_name,
                "status": "DRIFT DETECTED" if detected_changes else "HEALTHY",
                "negative_alerts": detected_changes,
                "missing_info_warnings": warnings,
                "raw_api_data": live_registry
            }
            final_report.append(report_entry)
            
            if detected_changes:
                print("   [ALERT] KYC Drift detected (LLM Escalation required):")
                for change in detected_changes:
                    print(f"      - {change}")
            else:
                print("   [HEALTH CHECK] Healthy profile. Data aligned with registry.")
                
            if warnings:
                for warning in warnings:
                    print(f"      [NOTE] {warning}")
        else:
            print("   [WARNING] Unable to fetch public data for this entity.")
            
    print("\n" + "="*60)
    print("End of scan.")
    
    # Save the report to a JSON file
    output_file = "kyc_drift_report.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(final_report, f, indent=4, ensure_ascii=False)
        
    print(f"[SUCCESS] Structured JSON report successfully generated: {output_file}")
