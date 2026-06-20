"""Company NER over scraped articles.

Reads news.json (produced by news_pipeline.py), runs GLiNER over each article's
clean_text to extract the companies mentioned, and writes an enriched copy to
news_entities.json. Prints a corpus-level summary of the most-mentioned
companies so NER quality can be eyeballed.

This is the extraction step only. Matching a given company name against these
entities (fuzzy / open matching) is a separate, later step.

Usage:
    python entity_extractor.py
"""

import json
import sys
from collections import Counter
from pathlib import Path

from gliner import GLiNER

# Reuse helpers from the sibling pipeline module. Importing it does NOT trigger
# scraping — that is guarded under `if __name__ == "__main__"`.
from news_pipeline import normalize_for_match, show_progress

BASE_DIR = Path(__file__).resolve().parent
INPUT_FILE = BASE_DIR / "news.json"
OUTPUT_FILE = BASE_DIR / "news_entities.json"

# Swap to "urchade/gliner_small-v2.1" for more speed, or a larger variant for
# more accuracy. medium is a good balance and fits comfortably in 16GB RAM.
MODEL_NAME = "urchade/gliner_medium-v2.1"
LABELS = ["company"]
THRESHOLD = 0.5

# GLiNER has a limited input window (~384 tokens). Chunk long article bodies by
# a word window well under that so nothing past the limit is silently dropped.
CHUNK_WORDS = 250


def pick_device():
    try:
        import torch
    except ImportError:
        return "cpu"
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def load_model():
    device = pick_device()
    print(f"Loading {MODEL_NAME} on {device} ...")
    model = GLiNER.from_pretrained(MODEL_NAME)
    try:
        model = model.to(device)
    except Exception as exc:  # noqa: BLE001 — fall back to CPU if device unusable
        print(f"Could not move model to {device} ({exc}); using cpu")
    return model


def chunk_text(text, chunk_words=CHUNK_WORDS):
    words = (text or "").split()
    for start in range(0, len(words), chunk_words):
        yield " ".join(words[start : start + chunk_words])


def extract_companies(model, text):
    """Return distinct companies in `text`, sorted by mention count desc.

    Entities are deduped by their normalized form (so "Apple", "Apple Inc." and
    "apple" collapse together) while the original surface form with the highest
    score is kept as the display name.
    """
    # key -> {"name": surface form, "score": best score, "mentions": count}
    aggregated = {}
    for chunk in chunk_text(text):
        if not chunk.strip():
            continue
        for ent in model.predict_entities(chunk, LABELS, threshold=THRESHOLD):
            surface = ent["text"].strip()
            key = normalize_for_match(surface)
            if not key:
                continue
            score = float(ent["score"])
            existing = aggregated.get(key)
            if existing is None:
                aggregated[key] = {"name": surface, "score": score, "mentions": 1}
            else:
                existing["mentions"] += 1
                if score > existing["score"]:
                    existing["score"] = score
                    existing["name"] = surface

    companies = list(aggregated.values())
    for company in companies:
        company["score"] = round(company["score"], 4)
    companies.sort(key=lambda c: (c["mentions"], c["score"]), reverse=True)
    return companies


def main():
    try:
        with INPUT_FILE.open("r", encoding="utf-8") as handle:
            articles = json.load(handle)
    except FileNotFoundError:
        print(f"{INPUT_FILE.name} not found — run news_pipeline.py first.")
        return
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Failed to read {INPUT_FILE}: {exc}")
        return

    print(f"Articles loaded: {len(articles)}")
    if not articles:
        return

    model = load_model()

    corpus_counter = Counter()
    articles_with_company = 0
    total = len(articles)
    for index, article in enumerate(articles, 1):
        companies = extract_companies(model, article.get("clean_text", ""))
        article["companies"] = companies
        if companies:
            articles_with_company += 1
        for company in companies:
            corpus_counter[company["name"]] += company["mentions"]
        show_progress("Extracting companies", index, total, f"tagged {articles_with_company}")

    with OUTPUT_FILE.open("w", encoding="utf-8") as handle:
        json.dump(articles, handle, indent=2)

    print(f"\nArticles processed:        {total}")
    print(f"Articles with ≥1 company:  {articles_with_company}")
    print(f"Distinct companies found:  {len(corpus_counter)}")
    print(f"Enriched data written to:  {OUTPUT_FILE.name}")
    print("\nTop companies by total mentions:")
    for name, count in corpus_counter.most_common(25):
        print(f"  {count:>4}  {name}")


if __name__ == "__main__":
    main()
