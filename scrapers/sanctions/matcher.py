"""Normalization + fuzzy matching of company names against sanctions records."""
#input: company name, output: list of matches with score, source, entity_id, programs, etc.
#goal: to find the best match for a given company name in the sanctions list, even if the name is not an exact match (e.g., due to typos, abbreviations, or variations in naming conventions).
#max returns 10 matches with minimum score of 85.0 (default) and can be adjusted with --threshold argument.

from __future__ import annotations

import math
import re
from collections.abc import Iterable

from rapidfuzz import fuzz
from rapidfuzz.distance import Levenshtein

from scrapers.sanctions.models import Match, SanctionRecord

# Common legal-form suffixes, stripped before comparison so "Acme Ltd" and
# "Acme Limited" score as equivalent rather than being penalized for the
# suffix difference.
_LEGAL_SUFFIXES = (
    "limited", "ltd", "llc", "lp", "llp", "inc", "incorporated", "corp",
    "corporation", "co", "company", "gmbh", "ag", "sa", "nv", "bv", "plc",
    "spa", "srl", "oy", "ab", "as", "kg", "kft", "sarl", "pty", "holding",
    "holdings", "group", "international", "intl",
)
_SUFFIX_RE = re.compile(
    r"\b(" + "|".join(_LEGAL_SUFFIXES) + r")\b\.?", re.IGNORECASE
)
_PUNCT_RE = re.compile(r"[^\w\s]")
_WS_RE = re.compile(r"\s+")


def normalize(name: str) -> str:
    name = name.upper()
    name = _PUNCT_RE.sub(" ", name)
    name = _SUFFIX_RE.sub(" ", name.lower()).upper()
    name = _WS_RE.sub(" ", name).strip()
    return name


def _word_weights(token_lists: list[list[str]]) -> dict[str, float]:
    """Smoothed inverse-document-frequency weight per word, computed over
    every candidate name in the list being screened against.

    A word that shows up in almost every name (e.g. "BANK", "NATIONAL",
    "OF") ends up with a weight close to the floor of 1.0. A word that
    shows up in only a handful of names (e.g. "CUBA") ends up with a much
    higher weight, so it dominates the comparison. Same formula
    scikit-learn's TfidfVectorizer uses by default (smooth_idf): words
    never seen in the corpus fall back to the maximum possible weight,
    since "never seen" is the most distinctive case there is.
    """
    n_docs = len(token_lists)
    doc_freq: dict[str, int] = {}
    for tokens in token_lists:
        for word in set(tokens):
            doc_freq[word] = doc_freq.get(word, 0) + 1
    return {word: math.log((n_docs + 1) / (df + 1)) + 1.0 for word, df in doc_freq.items()}


def _weight(word: str, weights: dict[str, float], n_docs: int) -> float:
    return weights.get(word, math.log(n_docs + 1) + 1.0)


def _directional_match(
    src_tokens: list[str], dst_tokens: list[str], weights: dict[str, float], n_docs: int
) -> tuple[float, float]:
    """For each word in src_tokens, find its best (fuzzy) match anywhere in
    dst_tokens, weighted by how distinctive that src word is. Returns
    (matched_weight, total_weight) so the caller can combine both
    directions into a symmetric score."""
    total = 0.0
    matched = 0.0
    for word in src_tokens:
        w = _weight(word, weights, n_docs)
        total += w
        best = max((fuzz.ratio(word, d) for d in dst_tokens), default=0.0)
        matched += w * (best / 100.0)
    return matched, total


# Below this word length, a percentage-based ratio is unreliable: "UBS" vs
# "UBIS" or "ROCHE" vs "ROCHEL" are a single inserted letter apart yet still
# score ~85-90% on a plain character ratio. Comparisons where both sides
# reduce to one word this short or shorter use an edit-distance penalty
# instead (see _short_single_word_score) so a one-letter difference can't
# pass as a near-match the way it can for longer names.
_SHORT_WORD_MAX_LEN = 6
_SHORT_WORD_PENALTY_PER_EDIT = 40.0


def _short_single_word_score(word_a: str, word_b: str) -> float:
    if word_a == word_b:
        return 100.0
    distance = Levenshtein.distance(word_a, word_b)
    return max(0.0, 100.0 - distance * _SHORT_WORD_PENALTY_PER_EDIT)


def _weighted_score(
    tokens_a: list[str], tokens_b: list[str], weights: dict[str, float], n_docs: int
) -> float:
    """Symmetric 0-100 similarity score: rare/distinctive shared words count
    far more than common words shared by almost every name, and words
    present on one side but missing on the other (in either direction)
    drag the score down."""
    if len(tokens_a) == 1 and len(tokens_b) == 1:
        if min(len(tokens_a[0]), len(tokens_b[0])) <= _SHORT_WORD_MAX_LEN:
            return _short_single_word_score(tokens_a[0], tokens_b[0])

    matched_a, total_a = _directional_match(tokens_a, tokens_b, weights, n_docs)
    matched_b, total_b = _directional_match(tokens_b, tokens_a, weights, n_docs)
    total = total_a + total_b
    if total == 0:
        return 0.0
    return 100.0 * (matched_a + matched_b) / total


class SanctionIndex:
    """Precomputes the word-weight table for a set of records once, so many
    names can be screened against it without recomputing the weights (which
    scan every record) on each call. Use this instead of `screen()` when
    checking more than a handful of names against the same records."""

    def __init__(self, records: Iterable[SanctionRecord]):
        self.records = list(records)
        self.choices = [normalize(r.name) for r in self.records]
        self.choice_tokens = [c.split() for c in self.choices]
        self.weights = _word_weights(self.choice_tokens)
        self.n_docs = len(self.choice_tokens)

    def screen(self, query: str, threshold: float = 85.0, limit: int = 10) -> list[Match]:
        """Fuzzy-match `query` against this index's records, returning hits
        scoring at or above `threshold` (0-100), best first, capped at
        `limit`."""
        query_norm = normalize(query)
        if not query_norm:
            return []
        query_tokens = query_norm.split()

        scored: list[tuple[int, float]] = []
        for idx, cand_tokens in enumerate(self.choice_tokens):
            score = _weighted_score(query_tokens, cand_tokens, self.weights, self.n_docs)
            if score >= threshold:
                scored.append((idx, score))

        scored.sort(key=lambda pair: pair[1], reverse=True)
        scored = scored[:limit]

        return [
            Match(
                record=self.records[idx],
                score=score,
                query_normalized=query_norm,
                name_normalized=self.choices[idx],
            )
            for idx, score in scored
        ]


def screen(
    query: str,
    records: Iterable[SanctionRecord],
    threshold: float = 85.0,
    limit: int = 10,
) -> list[Match]:
    """Fuzzy-match `query` against `records`, returning hits scoring at or
    above `threshold` (0-100), best first, capped at `limit`. One-off
    convenience wrapper around SanctionIndex for a single query."""
    return SanctionIndex(records).screen(query, threshold=threshold, limit=limit)
