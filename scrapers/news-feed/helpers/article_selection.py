"""Select articles that mention a given company.

Takes a company name, scans the NER-enriched articles in news_entities.json
(produced by entity_extractor.py), and writes a JSON containing the company name
plus only the articles whose extracted company entities match the input.

Matching is "open", not letter-by-letter: names are compared case- and
punctuation-insensitively, and one is allowed to be a contiguous token
subsequence of the other. So "Apple" matches "Apple Inc." and "apple", but not
"Snapple".

Usage:
    python article_selection.py "Apple"
    python article_selection.py "JPMorgan Chase" -o jpm.json
"""

import argparse
import json
import re
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # news-feed root (this file lives in helpers/)
INPUT_FILE = BASE_DIR / "news_entities.json"
# Per-company selected-article files land here, one per KYC customer, so each
# stage of the pipeline leaves an inspectable artifact.
SELECTED_DIR = BASE_DIR / "selected"
KYC_FILE = BASE_DIR.parent.parent / "docs" / "kyc_database.json"


def normalize_company(name):
    """Lowercase, turn punctuation into spaces, collapse whitespace.

    Punctuation -> space (not deletion) so "Coca-Cola" -> "coca cola" and
    "Apple, Inc." -> "apple inc" tokenize sensibly.
    """
    name = (name or "").lower()
    name = re.sub(r"[^\w\s]", " ", name)
    return re.sub(r"\s+", " ", name).strip()


def tokens(name):
    return normalize_company(name).split()


def _is_contiguous_subsequence(short, long):
    n = len(short)
    if not n or n > len(long):
        return False
    return any(long[i : i + n] == short for i in range(len(long) - n + 1))


def name_matches(query_tokens, entity_tokens):
    """True if either name is a contiguous token subsequence of the other."""
    if not query_tokens or not entity_tokens:
        return False
    return _is_contiguous_subsequence(query_tokens, entity_tokens) or _is_contiguous_subsequence(
        entity_tokens, query_tokens
    )


def select_articles(articles, company):
    query_tokens = tokens(company)
    if not query_tokens:
        return []

    selected = []
    for article in articles:
        matched = [
            comp
            for comp in article.get("companies", [])
            if name_matches(query_tokens, tokens(comp.get("name", "")))
        ]
        if matched:
            entry = dict(article)
            entry["matched_companies"] = matched
            selected.append(entry)

    # Most relevant first: by how many times the matched entity was mentioned.
    selected.sort(
        key=lambda a: max(c.get("mentions", 0) for c in a["matched_companies"]),
        reverse=True,
    )
    return selected


def slugify(name):
    slug = re.sub(r"[^\w]+", "_", name.lower()).strip("_")
    return slug or "company"


def load_articles():
    try:
        with INPUT_FILE.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        raise SystemExit(f"{INPUT_FILE.name} not found — run entity_extractor.py first.")
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Failed to read {INPUT_FILE}: {exc}")


def write_selection(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def run_single(articles, company, output):
    selected = select_articles(articles, company)
    output_path = Path(output) if output else BASE_DIR / "selected_articles.json"
    write_selection(output_path, {
        "company": company,
        "article_count": len(selected),
        "articles": selected,
    })
    print(f"Company:           {company}")
    print(f"Articles scanned:  {len(articles)}")
    print(f"Articles matched:  {len(selected)}")
    print(f"Written to:        {output_path.name}")
    if selected:
        print("\nTop matches:")
        for article in selected[:10]:
            names = ", ".join(sorted({c["name"] for c in article["matched_companies"]}))
            print(f"  - {article.get('title', '')[:80]}  [{names}]")


def run_kyc_batch(articles, kyc_path):
    """Select articles for every customer in the KYC DB, one file per company.

    Each output file carries the customer's company_id and legal_name so the
    downstream drift step can join it back to the KYC baseline without
    re-running entity matching.
    """
    try:
        with Path(kyc_path).open("r", encoding="utf-8") as handle:
            customers = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Failed to read KYC DB {kyc_path}: {exc}")

    SELECTED_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Customers: {len(customers)}   Articles scanned: {len(articles)}\n")
    for customer in customers:
        company_id = customer.get("company_id", "")
        legal_name = customer.get("legal_name", "")
        selected = select_articles(articles, legal_name)
        out_path = SELECTED_DIR / f"{company_id}.json"
        write_selection(out_path, {
            "company_id": company_id,
            "legal_name": legal_name,
            "article_count": len(selected),
            "articles": selected,
        })
        print(f"  {legal_name:<24} {len(selected):>3} articles -> selected/{out_path.name}")


def main():
    parser = argparse.ArgumentParser(description="Select articles mentioning a company.")
    parser.add_argument("company", nargs="*", help="Company name to search for")
    parser.add_argument("-o", "--output", help="Output JSON path (default: selected_articles.json)")
    parser.add_argument(
        "--kyc-db", nargs="?", const=str(KYC_FILE),
        help="Batch mode: select for every customer in the KYC DB (default docs/kyc_database.json)",
    )
    args = parser.parse_args()

    articles = load_articles()

    if args.kyc_db:
        run_kyc_batch(articles, args.kyc_db)
        return

    if not args.company:
        parser.error("provide a company name, or use --kyc-db for batch mode")
    run_single(articles, " ".join(args.company).strip(), args.output)


if __name__ == "__main__":
    main()
