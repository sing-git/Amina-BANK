from article_selection import (
    normalize_company,
    tokens,
    _is_contiguous_subsequence,
    name_matches,
    select_articles,
    slugify,
)


def test_normalize_company_lowercases_and_despunctuates():
    assert normalize_company("Coca-Cola") == "coca cola"
    assert normalize_company("Apple, Inc.") == "apple inc"


def test_tokens_splits_normalized_name_into_words():
    assert tokens("JPMorgan Chase & Co.") == ["jpmorgan", "chase", "co"]


def test_contiguous_subsequence_matches_when_short_name_is_inside_long_name():
    assert _is_contiguous_subsequence(["apple"], ["apple", "inc"]) is True


def test_contiguous_subsequence_does_not_match_unrelated_word():
    # "snapple" is not the same word as "apple" — must not match.
    assert _is_contiguous_subsequence(["snapple"], ["apple", "inc"]) is False


def test_contiguous_subsequence_false_when_short_is_longer_than_long():
    assert _is_contiguous_subsequence(["apple", "inc"], ["apple"]) is False


def test_name_matches_apple_matches_apple_inc():
    assert name_matches(tokens("Apple"), tokens("Apple Inc.")) is True


def test_name_matches_apple_does_not_match_snapple():
    # The exact counter-example from the original author's own docstring.
    assert name_matches(tokens("Apple"), tokens("Snapple")) is False


def test_select_articles_keeps_only_matching_articles_and_sorts_by_mentions():
    articles = [
        {"title": "Apple unveils new phone", "companies": [{"name": "Apple Inc.", "mentions": 3}]},
        {"title": "Unrelated snack news", "companies": [{"name": "Snapple", "mentions": 10}]},
        {"title": "Apple stock dips", "companies": [{"name": "Apple", "mentions": 1}]},
    ]

    selected = select_articles(articles, "Apple")

    titles = [a["title"] for a in selected]
    assert "Unrelated snack news" not in titles
    assert titles == ["Apple unveils new phone", "Apple stock dips"]  # higher mentions first


def test_select_articles_with_no_matches_returns_empty_list():
    articles = [{"title": "Unrelated snack news", "companies": [{"name": "Snapple", "mentions": 10}]}]
    assert select_articles(articles, "Apple") == []


def test_slugify_turns_name_into_filename_safe_text():
    assert slugify("Acme Bank S.A.") == "acme_bank_s_a"


def test_slugify_falls_back_to_company_for_empty_input():
    assert slugify("") == "company"
    assert slugify("...") == "company"
