from scrapers.sanctions.matcher import (
    normalize,
    _short_single_word_score,
    _weighted_score,
    SanctionIndex,
    screen,
)
from scrapers.sanctions.models import SanctionRecord


# --- normalize(): cleaning up a name before comparing it ---

def test_normalize_strips_common_legal_suffixes():
    # "Ltd" is just corporate paperwork language — it shouldn't affect matching.
    assert normalize("Acme Holdings Ltd.") == "ACME"


def test_normalize_strips_gmbh_suffix():
    assert normalize("Acme GmbH") == "ACME"


def test_normalize_does_not_strip_a_dotted_suffix_like_S_A():
    # Punctuation is turned into spaces BEFORE suffix-stripping runs, so
    # "S.A." becomes two separate single letters ("S", "A") by the time the
    # suffix check happens — and "s"/"a" individually aren't in the known
    # suffix list (only the whole word "sa" is). So this dotted form is NOT
    # stripped, unlike "Ltd"/"GmbH"/plain "SA" without dots. A real quirk in
    # the matching code, not a bug this test suite is meant to fix — this
    # test documents the actual current behavior.
    assert normalize("Banco Nacional S.A.") == "BANCO NACIONAL S A"


def test_normalize_strips_undotted_sa_suffix():
    # Without the dots, "SA" survives as one token and IS recognized as a
    # legal-form suffix.
    assert normalize("Banco Nacional SA") == "BANCO NACIONAL"


def test_normalize_collapses_punctuation_to_spaces():
    # Punctuation shouldn't glue or split words in a way that breaks matching.
    assert normalize("O'Brien & Sons, Inc.") == "O BRIEN SONS"


# --- _short_single_word_score(): comparing two short, single-word names ---

def test_short_word_exact_match_scores_100():
    assert _short_single_word_score("UBS", "UBS") == 100.0


def test_short_word_one_letter_typo_is_penalized_40_points():
    # "UBIS" is one inserted letter away from "UBS" — a real near-miss that
    # should NOT score as a near-perfect match just because it's mostly the
    # same letters.
    assert _short_single_word_score("UBS", "UBIS") == 60.0


def test_short_word_very_different_names_clamp_to_zero():
    # Many edits apart — score should never go negative, just floor at 0.
    assert _short_single_word_score("UBS", "XYZQRT") == 0.0


# --- _weighted_score(): the full multi-word similarity score (0-100) ---

def test_weighted_score_is_symmetric():
    # Comparing A to B should give the same answer as comparing B to A.
    weights = {"NATIONAL": 1.0, "BANK": 1.0, "OF": 1.0, "CUBA": 3.0}
    a = ["NATIONAL", "BANK", "OF", "CUBA"]
    b = ["BANCO", "NATIONAL", "CUBA"]
    score_ab = _weighted_score(a, b, weights, n_docs=10)
    score_ba = _weighted_score(b, a, weights, n_docs=10)
    assert score_ab == score_ba


def test_weighted_score_rewards_matching_rare_distinctive_words_more():
    # "BANK" appears in almost every name in this made-up corpus, so it's not
    # very distinctive. "CUBA" appears in hardly any name, so sharing "CUBA"
    # should matter a lot more than sharing "BANK".
    weights = {"BANK": 1.0, "OF": 1.0, "NATIONAL": 1.0, "CUBA": 5.0}
    query = ["CUBA"]
    candidate_sharing_rare_word = ["BANCO", "CUBA"]
    candidate_sharing_common_word = ["NATIONAL", "BANK", "OF", "AMERICA"]
    score_rare = _weighted_score(query, candidate_sharing_rare_word, weights, n_docs=10)
    score_common = _weighted_score(query, candidate_sharing_common_word, weights, n_docs=10)
    assert score_rare > score_common


# --- screen() / SanctionIndex: the end-to-end "search this name" function ---

def _sample_records():
    return [
        SanctionRecord(
            source="OFAC", list_name="SDN List", entity_id="1",
            entity_type="Entity", name="BANCO NACIONAL DE CUBA",
            is_primary=True, programs=("CUBA",),
        ),
        SanctionRecord(
            source="OFAC", list_name="SDN List", entity_id="2",
            entity_type="Entity", name="NORTH STAR TRADING FZE",
            is_primary=True, programs=(),
        ),
        SanctionRecord(
            source="OFAC", list_name="SDN List", entity_id="3",
            entity_type="Individual", name="IVAN PETROV",
            is_primary=True, programs=(),
        ),
    ]


def test_screen_exact_name_match_scores_100():
    matches = screen("Banco Nacional de Cuba", _sample_records())
    assert len(matches) == 1
    assert matches[0].score == 100.0
    assert matches[0].record.name == "BANCO NACIONAL DE CUBA"


def test_screen_unrelated_name_returns_no_matches():
    matches = screen("Totally Unrelated Bakery Co", _sample_records(), threshold=85.0)
    assert matches == []


def test_screen_results_sorted_best_match_first():
    # "North Star" is a partial/weaker match to one record; make sure if
    # multiple records qualify, the best one comes first.
    matches = screen("North Star Trading", _sample_records(), threshold=50.0)
    assert len(matches) >= 1
    scores = [m.score for m in matches]
    assert scores == sorted(scores, reverse=True)


def test_screen_limit_caps_number_of_results():
    matches = screen("Trading", _sample_records(), threshold=0.0, limit=1)
    assert len(matches) <= 1


def test_screen_empty_query_returns_no_matches():
    assert screen("", _sample_records()) == []
    assert screen("   ", _sample_records()) == []


def test_sanction_index_reused_across_multiple_queries_matches_one_off_screen():
    # SanctionIndex precomputes once and is meant to be reused for speed; its
    # answer for a given name must match what the one-off screen() gives.
    index = SanctionIndex(_sample_records())
    from_index = index.screen("Ivan Petrov")
    from_one_off = screen("Ivan Petrov", _sample_records())
    assert [m.score for m in from_index] == [m.score for m in from_one_off]
