from signal_extractor import (
    clean_linked_entities,
    normalize_signal,
    format_personnel,
    dedupe_by_url,
    is_primary_subject,
    DRIFT_DIMENSIONS,
)


def test_clean_linked_entities_keeps_well_formed_entries():
    raw = [{"name": "  Jane Doe ", "role": " new CEO "}]
    assert clean_linked_entities(raw) == [{"name": "Jane Doe", "role": "new CEO"}]


def test_clean_linked_entities_drops_entries_with_blank_name():
    raw = [{"name": "   ", "role": "investor"}]
    assert clean_linked_entities(raw) == []


def test_clean_linked_entities_handles_non_list_input():
    assert clean_linked_entities(None) == []
    assert clean_linked_entities("not a list") == []


def test_clean_linked_entities_coerces_plain_strings():
    assert clean_linked_entities(["Jane Doe"]) == [{"name": "Jane Doe", "role": ""}]


def test_normalize_signal_rejects_no_notable_change():
    assert normalize_signal({"notable_change": False, "dimension": "ownership_change"}) is None


def test_normalize_signal_rejects_unrecognized_dimension():
    result = {"notable_change": True, "dimension": "made_up_category", "linked_entities": []}
    assert normalize_signal(result) is None


def test_normalize_signal_accepts_a_valid_recognized_dimension():
    result = {
        "notable_change": True,
        "dimension": "key_personnel_change",
        "linked_entities": [{"name": "Jane Doe", "role": "incoming CEO"}],
    }
    normalized = normalize_signal(result)
    assert normalized == {
        "dimension": "key_personnel_change",
        "linked_entities": [{"name": "Jane Doe", "role": "incoming CEO"}],
    }


def test_normalize_signal_rejects_non_dict_input():
    assert normalize_signal(None) is None
    assert normalize_signal("yes") is None


def test_every_drift_dimension_is_a_non_empty_string():
    # sanity check on the constant itself — guards against an accidental typo
    # silently turning a real category into a permanently-unmatchable one.
    assert len(DRIFT_DIMENSIONS) == 7
    assert all(isinstance(d, str) and d for d in DRIFT_DIMENSIONS)


def test_format_personnel_with_no_data_says_not_recorded():
    assert format_personnel({}) == "not recorded"
    assert format_personnel(None) == "not recorded"


def test_format_personnel_formats_role_name_pairs():
    assert format_personnel({"CEO": "Jane Doe", "CFO": "John Smith"}) == "CEO: Jane Doe, CFO: John Smith"


def test_dedupe_by_url_keeps_first_occurrence_only():
    articles = [
        {"url": "https://example.com/a", "title": "First"},
        {"url": "https://example.com/a/", "title": "Duplicate (trailing slash)"},
        {"url": "https://example.com/b", "title": "Different article"},
    ]
    unique = dedupe_by_url(articles)
    assert [a["title"] for a in unique] == ["First", "Different article"]


def test_dedupe_by_url_never_drops_entries_with_no_url():
    articles = [{"url": "", "title": "No url 1"}, {"url": "", "title": "No url 2"}]
    assert len(dedupe_by_url(articles)) == 2


def test_is_primary_subject_true_when_mention_count_meets_floor():
    article = {"matched_companies": [{"name": "Acme", "mentions": 1}]}
    assert is_primary_subject(article) is True


def test_is_primary_subject_false_when_no_companies_matched():
    assert is_primary_subject({"matched_companies": []}) is False
