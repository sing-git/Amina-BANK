import time

from scrapers.sanctions.cache import _cache_key


def test_cache_key_is_stable_for_an_unchanged_file(tmp_path):
    f = tmp_path / "source.xml"
    f.write_text("some sanctions data", encoding="utf-8")

    key_first_check = _cache_key(f)
    key_second_check = _cache_key(f)

    assert key_first_check == key_second_check


def test_cache_key_changes_when_file_content_size_changes(tmp_path):
    f = tmp_path / "source.xml"
    f.write_text("some sanctions data", encoding="utf-8")
    key_before = _cache_key(f)

    time.sleep(0.01)  # make sure the modified-time actually ticks forward
    f.write_text("some sanctions data PLUS MORE", encoding="utf-8")
    key_after = _cache_key(f)

    assert key_before != key_after
