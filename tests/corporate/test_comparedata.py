from comparedata import detect_registry_changes


def _internal(**overrides):
    base = {
        "legal_name": "Acme Bank",
        "company_status": "Active",
        "jurisdiction": "UK",
        "key_personnel": {"CEO": "Jane Doe"},
    }
    base.update(overrides)
    return base


def _live(**overrides):
    base = {
        "legal_name": "Acme Bank Ltd",
        "company_status": "Active",
        "jurisdiction": "UK",
        "officers": {"CEO": "Jane Doe"},
    }
    base.update(overrides)
    return base


def test_clean_case_with_no_changes_produces_no_flags_or_warnings():
    flags, warnings = detect_registry_changes(_internal(), _live())
    assert flags == []
    assert warnings == []


def test_name_mismatch_is_flagged():
    flags, _ = detect_registry_changes(
        _internal(legal_name="Acme Bank"),
        _live(legal_name="Totally Different Company Name"),
    )
    assert any("Entity Identity Change" in f for f in flags)


def test_critical_status_change_is_flagged_when_company_becomes_dissolved():
    flags, _ = detect_registry_changes(
        _internal(company_status="Active"),
        _live(company_status="Dissolved"),
    )
    assert any("Critical Status Change" in f for f in flags)


def test_status_change_to_a_normal_value_is_not_flagged():
    # "unknown"/"active"/"normal" are all treated as non-alarming.
    flags, _ = detect_registry_changes(
        _internal(company_status="Active"),
        _live(company_status="Normal"),
    )
    assert not any("Critical Status Change" in f for f in flags)


def test_jurisdiction_move_is_flagged():
    flags, _ = detect_registry_changes(
        _internal(jurisdiction="UK"),
        _live(jurisdiction="Singapore"),
    )
    assert any("Jurisdiction Moved" in f for f in flags)


def test_personnel_marked_as_api_limited_becomes_a_warning_not_a_flag():
    flags, warnings = detect_registry_changes(
        _internal(key_personnel={"CEO": "Jane Doe"}),
        _live(officers={"CEO": "API ZEFIX: Not provided"}),
    )
    assert flags == []
    assert any("not tracked by this API" in w for w in warnings)


def test_personnel_removed_is_flagged():
    flags, _ = detect_registry_changes(
        _internal(key_personnel={"CEO": "Jane Doe"}),
        _live(officers={"CEO": "Not listed"}),
    )
    assert any("removed" in f for f in flags)


def test_personnel_changed_to_an_unrelated_name_is_flagged():
    flags, _ = detect_registry_changes(
        _internal(key_personnel={"CEO": "Jane Doe"}),
        _live(officers={"CEO": "Someone Completely Different"}),
    )
    assert any("changed" in f for f in flags)


def test_personnel_with_a_minor_typo_in_live_data_is_still_recognized():
    # "Smyth" is a one-letter-off near match of "Smith" — the fuzzy matching
    # is supposed to tolerate small typos in the live registry data.
    flags, _ = detect_registry_changes(
        _internal(key_personnel={"CEO": "Jane Smith"}),
        _live(officers={"CEO": "Jane Smyth"}),
    )
    assert not any("CEO changed" in f for f in flags)
