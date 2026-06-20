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

BASE_DIR = Path(__file__).resolve().parent
INPUT_FILE = BASE_DIR / "news_entities.json"


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


def main():
    parser = argparse.ArgumentParser(description="Select articles mentioning a company.")
    parser.add_argument("company", nargs="+", help="Company name to search for")
    parser.add_argument("-o", "--output", help="Output JSON path (default: articles_<slug>.json)")
    args = parser.parse_args()

    company = " ".join(args.company).strip()

    try:
        with INPUT_FILE.open("r", encoding="utf-8") as handle:
            articles = json.load(handle)
    except FileNotFoundError:
        print(f"{INPUT_FILE.name} not found — run entity_extractor.py first.")
        return
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Failed to read {INPUT_FILE}: {exc}")
        return

    selected = select_articles(articles, company)

    output_path = Path(args.output) if args.output else BASE_DIR / f"selected_articles.json"
    result = {
        "company": company,
        "article_count": len(selected),
        "articles": selected,
    }
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)

    print(f"Company:           {company}")
    print(f"Articles scanned:  {len(articles)}")
    print(f"Articles matched:  {len(selected)}")
    print(f"Written to:        {output_path.name}")
    if selected:
        print("\nTop matches:")
        for article in selected[:10]:
            names = ", ".join(sorted({c["name"] for c in article["matched_companies"]}))
            print(f"  - {article.get('title', '')[:80]}  [{names}]")


if __name__ == "__main__":
    main()
