"""Layer 2 — Keyword & NLP scorer.

Reads raw signals from layer1_signals.json (produced by Layer 1 collectors)
and applies four scoring components to news signals:

  1. Keyword lexicon  — ~500 terms across 15 signal types
  2. Entity fuzzy match — rapidfuzz ratio vs KYC company name
  3. Embedding cosine  — sentence-transformers drift vs KYC business model (optional)
  4. Rule-based delta  — CEO mention with negative verb, jurisdiction signals, etc.

Domain signals from domain_monitor.py already carry deterministic scores
and are passed through unchanged.

Outputs layer2_output.json with risk_score and escalate_to_stage2 on every signal.

Usage:
    python keyword_scorer.py
    python keyword_scorer.py --no-embeddings
"""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from rapidfuzz import fuzz

BASE_DIR     = Path(__file__).resolve().parent
INPUT_FILE   = BASE_DIR / "layer1_signals.json"
OUTPUT_FILE  = BASE_DIR / "layer2_output.json"
AUDIT_LOG    = BASE_DIR / "audit_log.jsonl"

ESCALATION_THRESHOLD = 0.40

# ---------------------------------------------------------------------------
# Keyword lexicon — 15 signal types, ~500 terms
# Scoring: first match sets signal_type; every subsequent hit adds 40% of its
# base_score (diminishing returns). Total capped at 1.0.
# ---------------------------------------------------------------------------
RISK_LEXICON = [

    # Tier 1 — Hard flags (0.85–0.98): immediate escalation
    ("SANCTIONS_HIT", 0.92, [
        "sanctions", "sanctioned", "ofac", "sdn list", "specially designated national",
        "eu sanctions", "eu financial sanctions", "un sanctions", "un security council",
        "uk sanctions", "hm treasury sanctions", "consolidated list",
        "swiss seco sanctions", "swiss sanctions",
        "blacklisted", "watchlist", "designated entity", "designated individual",
        "targeted sanctions", "asset freeze", "assets frozen", "funds frozen",
        "travel ban", "arms embargo", "export ban", "import ban",
        "delistment", "relisted", "added to sanctions list",
        "interpol red notice", "interpol notice", "europol",
        "fatf blacklist", "fatf grey list", "fatf high-risk jurisdiction",
        "non-cooperative jurisdiction", "aml deficiencies",
        "sanctions evasion", "sanctions circumvention", "sanctions busting",
        "front company", "shell company sanctions", "proxy entity",
    ]),

    ("TERRORISM_FINANCING", 0.98, [
        "terrorism", "terrorist financing", "financing terrorism",
        "counter-terrorism", "terrorist organisation", "proscribed organisation",
        "designated terrorist", "terrorist network", "extremist group",
        "jihad", "isis", "al-qaeda", "hezbollah", "hamas", "al-shabaab",
        "boko haram", "wagner group", "sanctioned militia",
        "proliferation financing", "weapons of mass destruction", "wmd",
        "nuclear proliferation", "ballistic missile", "dual-use goods",
        "export control violation", "arms trafficking",
        "sdgt", "specially designated global terrorist", "terrorist asset freezing",
    ]),

    ("CRIMINAL_CHARGES", 0.86, [
        "arrested", "arrest warrant", "detained", "apprehended", "in custody",
        "indicted", "indictment", "charged", "criminal charges", "criminal complaint",
        "extradited", "extradition", "deportation order", "fugitive",
        "convicted", "conviction", "found guilty", "guilty plea", "plea deal",
        "sentenced", "prison sentence", "jail term", "custodial sentence",
        "acquitted", "charges dropped",
        "fraud", "wire fraud", "bank fraud", "mail fraud", "insurance fraud",
        "tax fraud", "tax evasion", "tax avoidance scheme",
        "money laundering", "aml violation", "structuring", "smurfing",
        "layering", "placement", "integration stage",
        "bribery", "corruption", "kickbacks", "embezzlement", "misappropriation",
        "market manipulation", "insider trading", "front running",
        "ponzi scheme", "pyramid scheme", "pump and dump",
        "securities fraud", "accounting fraud", "falsified accounts",
        "identity theft", "document forgery", "forged documents",
        "organised crime", "criminal syndicate", "cartel", "mafia",
        "drug trafficking", "narcotics", "human trafficking",
        "cybercrime", "ransomware attack", "crypto theft",
        "interpol red notice", "red notice issued", "international warrant",
        "cross-border investigation",
    ]),

    # Tier 2 — High-risk structural flags (0.70–0.84)
    ("ENTITY_DISSOLVED", 0.80, [
        "dissolved", "dissolution", "voluntary dissolution", "struck off",
        "deregistered", "deregistration", "removed from register",
        "wound up", "winding up", "winding-up order",
        "liquidated", "liquidation", "compulsory liquidation", "creditors liquidation",
        "in administration", "administrator appointed", "administrative receiver",
        "receivership", "receiver appointed",
        "bankrupt", "bankruptcy", "declared bankrupt", "bankruptcy filing",
        "chapter 11", "chapter 7", "chapter 15", "insolvency proceedings",
        "insolvent", "unable to pay debts", "debt moratorium",
        "creditor protection", "debt restructuring", "schemes of arrangement",
        "shut down", "ceased operations", "operations suspended", "permanently closed",
        "exit scam", "rug pull", "disappeared", "gone dark",
    ]),

    ("ADVERSE_REGULATORY", 0.75, [
        "regulatory investigation", "regulatory probe", "regulatory action",
        "under investigation", "formal inquiry", "supervisory review",
        "regulatory scrutiny", "regulatory concern",
        "enforcement action", "enforcement order", "regulatory order",
        "cease and desist", "stop order", "prohibition order",
        "public censure", "public reprimand", "formal warning",
        "consent order", "deferred prosecution agreement", "dpa",
        "non-prosecution agreement", "npa",
        "license revoked", "licence revoked", "license suspended",
        "licence suspended", "license cancelled", "authorisation withdrawn",
        "registration cancelled", "de-authorised", "banned from operating",
        "unregistered", "operating without license", "unlicensed",
        "fined", "fine imposed", "civil penalty", "financial penalty",
        "disgorgement", "restitution order", "compensation order",
        "record fine", "multimillion fine",
        "sec charges", "sec enforcement", "sec fraud charges",
        "cftc action", "cftc enforcement", "cftc charges",
        "finra", "finra sanction", "finra bar",
        "fca action", "fca enforcement", "fca fine", "fca warning",
        "pra action", "pra enforcement",
        "bafin", "bafin warning", "bafin enforcement",
        "finma", "finma enforcement", "finma investigation",
        "mas enforcement", "mas action", "monetary authority of singapore",
        "hkma enforcement", "hkma action",
        "ecb enforcement", "ecb supervisory",
        "doj", "department of justice", "doj charges",
        "fbi investigation", "fbi raid",
        "sfo investigation", "serious fraud office",
        "suspicious activity report", "sar filed", "suspicious transaction",
        "aml failure", "kyc failure", "compliance failure",
    ]),

    ("CYBER_INCIDENT", 0.70, [
        "data breach", "security breach", "cyber breach",
        "hacked", "hack", "cyberattack", "cyber attack",
        "ransomware", "ransomware attack", "ransomware demand",
        "malware", "malware infection", "trojan", "spyware",
        "phishing attack", "spear phishing", "whaling attack",
        "social engineering attack",
        "crypto theft", "crypto hack", "exchange hack",
        "hot wallet drained", "cold wallet compromised",
        "private key stolen", "protocol exploit",
        "smart contract exploit", "defi exploit", "bridge hack",
        "flash loan attack", "rug pull", "exit scam",
        "lazarus group", "north korean hackers", "apt",
        "advanced persistent threat", "state-sponsored hack",
        "nation-state attack",
        "customer data stolen", "data leak", "data exposed",
        "credentials leaked", "personal data breach",
        "gdpr breach", "data protection violation",
        "systems down", "outage", "service disruption",
        "platform down", "trading halted", "withdrawal suspended",
    ]),

    ("PEP_EXPOSURE", 0.55, [
        "politically exposed person", "pep status", "pep screening",
        "pep list", "senior political figure", "pep risk",
        "government minister", "head of state", "prime minister",
        "cabinet minister", "senior state official", "foreign minister",
        "finance minister", "deputy minister", "head of government",
        "member of parliament", "senior judiciary",
        "military commander", "senior military officer",
        "intelligence official", "spy chief",
        "state-owned enterprise", "government-controlled company",
        "sovereign wealth fund", "state-backed entity",
        "government ownership", "state shareholding",
        "pep associate", "family member of pep",
        "politically connected", "government ties",
        "close associate of", "political connections",
        "kleptocracy", "kleptocrat", "stolen assets", "asset recovery",
        "unexplained wealth order", "illicit enrichment",
        "abuse of public office", "misuse of public funds",
        "political bribery", "corrupt official",
    ]),

    # Tier 3 — Medium-risk structural changes (0.55–0.69)
    ("CEO_CHANGE", 0.62, [
        "ceo resign", "ceo resignation", "ceo steps down", "ceo departure",
        "ceo fired", "ceo dismissed", "ceo terminated", "ceo ousted",
        "ceo removed", "ceo replaced", "ceo leaves", "ceo exit",
        "founder resign", "founder departure", "founder steps down",
        "co-founder resign", "coo resign", "cfo resign", "cto resign",
        "cfo transition", "cfo change", "cfo departure", "new cfo", "cfo appointed",
        "coo transition", "cto transition", "cto departure", "new cto", "new coo",
        "chairman resign", "board chair resign",
        "new ceo", "ceo appointed", "interim ceo", "acting ceo",
        "new management", "new leadership", "management change",
        "leadership transition", "leadership overhaul",
        "ceo arrested", "ceo charged", "ceo investigated",
        "ceo suspended", "ceo placed on leave", "ceo under investigation",
        "leadership crisis", "management crisis", "boardroom battle",
        "boardroom coup", "management shake-up", "executive purge",
        "mass resignation", "executive exodus", "leadership vacuum",
        "key man risk", "key person departure",
    ]),

    ("OWNERSHIP_CHANGE", 0.58, [
        "acquisition", "acquired by", "takeover", "hostile takeover",
        "merger", "merged with", "consolidation",
        "buyout", "leveraged buyout", "lbo", "management buyout", "mbo",
        "private equity acquisition", "pe buyout",
        "new shareholder", "new major shareholder", "new investor",
        "majority stake", "controlling stake", "significant stake",
        "stake acquisition", "share purchase", "block trade",
        "change of control", "control transfer", "ownership transfer",
        "beneficial owner", "beneficial ownership change", "ubo change",
        "ultimate beneficial owner", "new ubo", "hidden ownership",
        "opaque ownership", "nominee director", "nominee shareholder",
        "bearer shares", "undisclosed ownership",
        "special purpose vehicle", "spv", "holding company change",
        "parent company change", "subsidiary transfer",
        "cross-border acquisition", "foreign ownership",
        "sovereign acquisition", "state acquisition",
    ]),

    ("JURISDICTION_CHANGE", 0.55, [
        "relocated", "redomiciled", "domicile change",
        "moved headquarters", "hq moved", "headquarters relocation",
        "registered office change", "new registered address",
        "re-incorporated", "reincorporated", "re-registered",
        "jurisdiction change", "change of jurisdiction",
        "cayman islands", "british virgin islands", "bvi",
        "panama", "panama papers", "pandora papers",
        "bermuda", "bahamas", "turks and caicos",
        "marshall islands", "vanuatu", "samoa",
        "seychelles", "mauritius", "malta", "cyprus",
        "liechtenstein", "monaco", "andorra",
        "dubai", "uae", "ras al khaimah",
        "delaware shell", "wyoming shell",
        "luxembourg holding", "ireland holding",
        "netherlands holding", "dutch holding",
        "tax haven", "offshore structure", "offshore entity",
        "letterbox company", "brass plate company",
        "shell company", "shelf company", "dormant entity",
        "complex ownership structure", "opaque structure",
        "layered ownership", "multi-jurisdictional",
    ]),

    # Tier 4 — KYC drift signals (0.45–0.57)
    ("BUSINESS_MODEL_PIVOT", 0.45, [
        "pivot", "pivoting to", "strategic pivot", "new direction",
        "rebranding", "rebranded", "rebrand",
        "renamed", "name change", "trading as", "formerly known as",
        "new business line", "new product line", "new vertical",
        "business model change", "business transformation",
        "new strategy", "strategic shift", "strategic review",
        "expanding into", "entering new market", "new market entry",
        "crypto", "cryptocurrency", "digital assets", "virtual assets",
        "nft", "non-fungible token", "metaverse",
        "defi", "decentralised finance", "decentralized finance",
        "web3", "blockchain", "tokenisation", "tokenization",
        "stablecoin", "algorithmic stablecoin",
        "gambling", "online gambling", "igaming", "sports betting",
        "cannabis", "marijuana", "cbd", "hemp",
        "arms dealing", "weapons", "military hardware",
        "adult content", "adult entertainment",
        "rapid expansion", "geographic expansion", "global expansion",
        "aggressive growth", "hypergrowth",
        "massive funding round", "unicorn valuation",
    ]),

    ("DORMANCY_BREAK", 0.52, [
        "dormant company", "previously dormant", "reactivated",
        "suddenly active", "resumed operations", "recommenced trading",
        "revived entity", "dormant account active",
        "shell activated", "shelf company activated",
        "sudden large transfer", "unexplained transfer", "unusual transaction",
        "transaction spike", "volume spike", "activity spike",
        "high volume suddenly", "large cash deposit", "large wire transfer",
        "structuring", "smurfing", "multiple small transfers",
        "rapid movement of funds", "layering", "funds moved quickly",
        "round-trip transaction", "circular payment", "back-to-back transfer",
        "inconsistent with profile", "unusual for customer",
        "atypical transaction", "abnormal activity",
        "behavioural anomaly", "pattern change",
    ]),

    ("STRUCTURAL_RISK", 0.38, [
        "legal form change", "converted to", "converted from",
        "gmbh to", "ag to", "llc to", "ltd to", "plc to",
        "private to public", "public to private", "going private",
        "delisted", "delisting", "voluntarily delisted",
        "spac merger", "blank check company", "reverse merger",
        "reverse takeover", "rto",
        "group restructuring", "corporate restructuring",
        "spin-off", "demerger", "carve-out", "divestiture",
        "subsidiary sold", "business unit sold",
        "intercompany transfer", "related party transaction",
        "connected party", "related party",
        "trust structure", "discretionary trust", "blind trust",
        "foundation", "private foundation", "family office",
        "multiple directorships", "cross-directorships",
        "circular shareholding", "golden share",
    ]),

    # Tier 5 — Adverse media / sentiment (0.18–0.44)
    ("ADVERSE_MEDIA", 0.32, [
        "scandal", "major scandal", "corporate scandal",
        "controversy", "embroiled in", "caught up in",
        "alleged fraud", "fraud allegations", "fraud claims",
        "corruption allegations", "corruption scandal",
        "misconduct", "serious misconduct", "gross misconduct",
        "whistleblower", "whistleblower claims", "leaked documents",
        "cover-up", "concealment", "information withheld",
        "lawsuit", "class action", "class action lawsuit",
        "legal action", "legal proceedings", "litigation",
        "sued", "suing", "counter-suit",
        "arbitration", "arbitration proceedings",
        "court order", "injunction", "restraining order",
        "investigative report", "exposé", "undercover investigation",
        "media investigation", "newspaper investigation",
        "documentary investigation", "leaked files",
        "panama papers", "pandora papers", "luanda leaks",
        "finance uncovered", "money trail",
        "reputational damage", "reputational risk",
        "public backlash", "public outcry", "public pressure",
        "ngo report", "transparency international",
        "global witness", "global financial integrity",
        "occrp", "organised crime and corruption reporting",
    ]),

    ("NEGATIVE_SENTIMENT", 0.18, [
        "collapse", "collapses", "collapsed", "collapsing",
        "crisis", "in crisis", "financial crisis",
        "failure", "failed", "fails",
        "default", "defaulted", "debt default", "sovereign default",
        "margin call", "margin calls", "forced selling",
        "liquidity crisis", "liquidity crunch", "funding squeeze",
        "cash flow problems", "running out of cash", "cash burn",
        "warning", "profit warning", "revenue warning",
        "concern", "serious concern", "growing concern",
        "trouble", "in trouble", "financial trouble",
        "problem", "serious problem", "systemic problem",
        "decline", "sharp decline", "steep decline",
        "loss", "significant loss", "record loss",
        "writedown", "write-off", "impairment",
        "downgrade", "credit downgrade", "rating downgrade",
        "share price crash", "stock crash", "market cap wipeout",
        "sell-off", "investor flight", "capital flight",
        "bank run", "deposit withdrawal", "withdrawal freeze",
        "trading suspended", "trading halt",
        "mass layoffs", "mass redundancies", "major job cuts",
        "restructuring costs", "severance",
    ]),
]


# ---------------------------------------------------------------------------
# Scoring components
# ---------------------------------------------------------------------------

def keyword_score(title: str, text: str) -> tuple:
    content = (title + " " + text).lower()
    score = 0.0
    primary_type = "NEGATIVE_SENTIMENT"
    matched = []
    for signal_type, base, terms in RISK_LEXICON:
        hits = [t for t in terms if t in content]
        if hits:
            matched.extend(hits)
            if score == 0.0:
                primary_type = signal_type
            score = min(1.0, score + base * (0.4 if score > 0 else 1.0))
    return round(score, 4), primary_type, list(set(matched))[:10]


def entity_fuzzy_score(signal: dict) -> float:
    legal_name = signal.get("kyc_legal_name", "") or signal.get("legal_name", "")
    domain     = signal.get("kyc_domain", "")
    targets    = [legal_name, domain.replace(".", " ")]
    companies  = signal.get("companies", [])
    title      = signal.get("title", "")
    summary    = signal.get("summary", "")

    if companies:
        best = max(
            fuzz.token_set_ratio(e.get("name", ""), t) / 100.0
            for e in companies for t in targets
        )
        return round(best, 4)

    best = 0.0
    for text in [title, summary]:
        for t in targets:
            best = max(best, fuzz.token_set_ratio(text, t) / 100.0)
    return round(best, 4)


_embedding_model = None


def get_embedding_model():
    global _embedding_model
    if _embedding_model is None:
        from sentence_transformers import SentenceTransformer
        print("Loading embedding model (all-MiniLM-L6-v2) ...")
        _embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
    return _embedding_model


def embedding_drift(text: str, baseline: str, use_embeddings: bool) -> float:
    if not use_embeddings or not text or not baseline:
        return 0.0
    try:
        import numpy as np
        vecs = get_embedding_model().encode(
            [text[:512], baseline], normalize_embeddings=True
        )
        return round((1.0 - float(np.dot(vecs[0], vecs[1]))) / 2.0, 4)
    except Exception:
        return 0.0


def rule_delta(title: str, text: str, signal: dict) -> tuple:
    content = (title + " " + text).lower()
    reasons = []
    negative_verbs = ["arrested", "charged", "resign", "fired", "fled", "convicted", "indicted"]
    for role, name in signal.get("kyc_key_personnel", {}).items():
        if name.lower() in content:
            for verb in negative_verbs:
                if verb in content:
                    reasons.append(f"{role} '{name}' mentioned with '{verb}'")
                    break
    legal_name = signal.get("kyc_legal_name", "").lower()
    if any(w in content for w in ["formerly known as", "renamed", "rebranded"]):
        if any(p in content for p in legal_name.split()[:2]):
            reasons.append("Entity rename signal near company name")
    domain = signal.get("kyc_domain", "")
    if domain and domain.lower() in content:
        if any(w in content for w in ["redirect", "suspended", "seized", "taken down", "new domain"]):
            reasons.append(f"Domain '{domain}' mentioned with change signal")
    for sig in ["moved to", "relocated to", "redomiciled", "now based in",
                "offshore", "cayman", "bvi", "malta", "seychelles"]:
        if sig in content:
            reasons.append(f"Jurisdiction change: '{sig}'")
            break
    return bool(reasons), reasons


def write_audit(entry: dict):
    with AUDIT_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


# ---------------------------------------------------------------------------
# Main scorer
# ---------------------------------------------------------------------------

def score_news_signal(signal: dict, use_embeddings: bool) -> dict:
    title   = signal.get("title", "")
    text    = signal.get("text", "")
    baseline = signal.get("kyc_business_model", "")

    kw_score, signal_type, matched_kw = keyword_score(title, text)
    fuzzy   = entity_fuzzy_score(signal)
    drift   = embedding_drift(text, baseline, use_embeddings)
    delta_detected, delta_reasons = rule_delta(title, text, signal)
    delta_boost = 0.20 if delta_detected else 0.0

    combined = round(min(1.0, kw_score * 0.45 + fuzzy * 0.15 + drift * 0.20 + delta_boost * 0.20), 4)

    # Sanctions hit overrides all scoring
    if signal.get("is_sanctioned"):
        combined    = max(combined, 0.90)
        signal_type = "SANCTIONS_HIT"

    scored = {
        **signal,
        "risk_score":            combined,
        "signal_type":           signal_type,
        "escalate_to_stage2":    combined >= ESCALATION_THRESHOLD,
        "keyword_score":         kw_score,
        "entity_fuzzy_score":    fuzzy,
        "embedding_drift_score": drift,
        "delta_flag":            delta_detected,
        "delta_reasons":         delta_reasons,
        "matched_keywords":      matched_kw,
        "layer":                 2,
        "scored_at":             datetime.now(timezone.utc).isoformat(),
    }
    write_audit(scored)
    return scored


def main():
    parser = argparse.ArgumentParser(description="Layer 2 keyword & NLP scorer.")
    parser.add_argument("--no-embeddings", action="store_true",
                        help="Skip sentence-transformer step (faster)")
    args = parser.parse_args()
    use_embeddings = not args.no_embeddings

    if not INPUT_FILE.exists():
        print(f"layer1_signals.json not found — run run_layer1.py first.")
        return

    with INPUT_FILE.open() as f:
        layer1 = json.load(f)

    if use_embeddings:
        get_embedding_model()

    results = []
    news_count = domain_count = 0

    for signal in layer1:
        cat = signal.get("category", "")
        if cat == "news":
            scored = score_news_signal(signal, use_embeddings)
            results.append(scored)
            news_count += 1
        else:
            # Domain / sanctions signals already have deterministic scores — pass through
            passthrough = {
                **signal,
                "layer": 2,
                "scored_at": datetime.now(timezone.utc).isoformat(),
            }
            if "escalate_to_stage2" not in passthrough:
                passthrough["escalate_to_stage2"] = passthrough.get("risk_score", 0) >= ESCALATION_THRESHOLD
            results.append(passthrough)
            domain_count += 1

    results.sort(key=lambda x: (not x.get("escalate_to_stage2"), -x.get("risk_score", 0)))

    with OUTPUT_FILE.open("w") as f:
        json.dump(results, f, indent=2)

    escalated = sum(1 for r in results if r.get("escalate_to_stage2"))
    print(f"\n{'='*60}")
    print(f"Layer 2 scoring complete")
    print(f"  News signals scored:    {news_count}")
    print(f"  Domain signals passed:  {domain_count}")
    print(f"  Total:                  {len(results)}")
    print(f"  Escalated to Stage 2:   {escalated}")
    print(f"  Output: {OUTPUT_FILE.name}")
    print(f"{'='*60}")

    top = [r for r in results if r.get("escalate_to_stage2")][:10]
    if top:
        print("\nTop escalated signals:")
        for r in top:
            name = r.get("legal_name", "")[:25]
            print(f"  [{r['risk_score']:.2f}] {r.get('signal_type',''):<28} {name:<26} "
                  f"{(r.get('title') or r.get('summary',''))[:40]}")


if __name__ == "__main__":
    main()
