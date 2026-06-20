import json

def load_internal_database(filepath="kyc_database.json"):
    """
    Charge la base de données de la banque (Layer 2) depuis le fichier JSON.
    """
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            database = json.load(f)
            print(f"✅ Succès : {len(database)} profils d'entreprises chargés depuis {filepath}.")
            return database
    except FileNotFoundError:
        print(f"❌ Erreur : Le fichier '{filepath}' est introuvable. Vérifie qu'il est dans le même dossier que ce script.")
        return []
    

def fetch_live_registry_data(company_name):
    """
    Simule un appel à OpenCorporates ou ZEFIX.
    Dans le vrai hackathon, tu feras : data = requests.get(api_url).json()
    """
    print(f"📡 Récupération des données publiques pour : {company_name}")
    
    # --- SIMULATION HACKATHON ---
    # L'entreprise a discrètement changé de juridiction (Offshore) 
    # et de forme légale (GmbH -> IBC).
    mock_api_responses = {
        "CryptoSwiss GmbH": {
            "legal_name": "CryptoSwiss Global",
            "jurisdiction": "Cayman Islands", # JURISDICTION MOVE (Offshore)
            "legal_form": "IBC",              # LEGAL FORM CHANGE (International Business Co)
            "company_status": "Active",
            "officers": {
                "CEO": "Lukas Meier"          # Le CEO n'a pas changé
            }
        }
    }
    
    return mock_api_responses.get(company_name)

# ==========================================
# 3. LE MOTEUR DE DÉTECTION (THE ALGORITHM)
# ==========================================
def detect_registry_changes(internal_data, live_data):
    """
    Compare les données d'onboarding avec les données API et génère les alertes exactes.
    """
    flags = []
    
    # 1. Changement de Juridiction (Structural Risk Change)
    if internal_data.get("jurisdiction", "").lower() != live_data.get("jurisdiction", "").lower():
        flags.append(f"Jurisdiction moved: '{internal_data.get('jurisdiction')}' -> '{live_data.get('jurisdiction')}'")

    # 2. Changement de Forme Légale (e.g. GmbH -> Offshore)
    if internal_data.get("legal_form", "").lower() != live_data.get("legal_form", "").lower():
        flags.append(f"Legal form changed: '{internal_data.get('legal_form')}' -> '{live_data.get('legal_form')}'")

    # 3. Changement de Nom (Entity Identity Change)
    if internal_data["legal_name"].lower() != live_data["legal_name"].lower():
        flags.append(f"Company name changed: '{internal_data['legal_name']}' -> '{live_data['legal_name']}'")
        
    # 4. Changement de Statut Opérationnel (e.g. Active -> Liquidation)
    live_status = live_data.get("company_status", "Active")
    if internal_data.get("status", "Active").lower() != live_status.lower():
        flags.append(f"Company status changed: '{internal_data.get('status')}' -> '{live_status}'")
        
    # 5. Changement de Direction (CEO / Officers)
    internal_personnel = internal_data.get("key_personnel", {})
    live_personnel = live_data.get("officers", {})
    
    for role, internal_name in internal_personnel.items():
        live_name = live_personnel.get(role)
        if not live_name:
            flags.append(f"{role} removed: {internal_name} n'est plus listé")
        elif internal_name.lower() != live_name.lower():
            flags.append(f"{role} changed: '{internal_name}' -> '{live_name}'")
            
    return flags

# ==========================================
# 4. EXÉCUTION
# ==========================================
if __name__ == "__main__":
    db = load_internal_database()
    target_company = db["CUST-005"]
    
    live_registry = fetch_live_registry_data(target_company["legal_name"])
    
    if live_registry:
        detected_changes = detect_registry_changes(target_company, live_registry)
        
        print("\n=== 🚨 RÉSULTATS D'ANALYSE DE DÉRIVE (KYC DRIFT) ===")
        if detected_changes:
            print("ATTENTION ! Des changements structurels sévères ont été détectés :")
            for change in detected_changes:
                print(f" ⚠️ {change}")
            print("\n-> Action requise : Escalade vers le LLM (Stage 2) pour analyse du risque offshore.")
        else:
            print("✅ Aucun changement détecté.")