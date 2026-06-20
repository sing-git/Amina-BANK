from news_pipeline import (
    clean_text,
    clean_summary_text,
    normalize_for_match,
    summary_is_usable,
    summarize_from_text,
    text_fingerprint,
    build_summary,
)


def test_clean_text_normalizes_line_endings_and_collapses_blank_lines():
    messy = "Line one\r\n\r\n\r\nLine two\r   trailing spaces   "
    cleaned = clean_text(messy)
    assert "\r" not in cleaned
    assert "\n\n\n" not in cleaned
    assert cleaned == cleaned.strip()


def test_clean_summary_text_strips_script_and_style_blocks_entirely():
    html = "<p>Real content</p><script>evil_code()</script><style>.x{color:red}</style>"
    cleaned = clean_summary_text(html)
    assert "evil_code" not in cleaned
    assert "color:red" not in cleaned
    assert "Real content" in cleaned


def test_clean_summary_text_unescapes_html_entities():
    assert "&" in clean_summary_text("Smith &amp; Sons")


def test_normalize_for_match_strips_trailing_source_suffix():
    # News titles often end in " - Reuters" / " - AP News" — that's noise for matching.
    result = normalize_for_match("Company X Faces Lawsuit - Reuters")
    assert "reuters" not in result
    assert "company x faces lawsuit" == result


def test_summary_is_usable_rejects_too_short_summaries():
    assert summary_is_usable("Too short", "Some title here") is False


def test_summary_is_usable_rejects_summary_that_just_repeats_the_title():
    title = "Company X announces major restructuring plan today"
    assert summary_is_usable(title, title) is False


def test_summary_is_usable_accepts_a_genuinely_distinct_summary():
    title = "Company X announces restructuring"
    summary = "The company said it will cut costs by closing two factories next year amid weak demand."
    assert summary_is_usable(summary, title) is True


def test_summarize_from_text_stays_within_word_budget():
    long_text = " ".join(f"This is sentence number {i}." for i in range(20))
    summary = summarize_from_text(long_text, max_words=20)
    assert len(summary.split()) <= 25  # small allowance for the trailing "..."


def test_summarize_from_text_always_includes_at_least_one_sentence():
    one_long_sentence = "word " * 100 + "."
    summary = summarize_from_text(one_long_sentence, max_words=10)
    assert summary != ""


def test_summarize_from_text_empty_input_returns_empty_string():
    assert summarize_from_text("") == ""


def test_text_fingerprint_is_same_for_same_text_and_different_for_different_text():
    a = text_fingerprint("Breaking news about Company X today!")
    b = text_fingerprint("Breaking news about Company X today!")
    c = text_fingerprint("Completely different story about something else.")
    assert a == b
    assert a != c


def test_build_summary_prefers_feed_summary_when_usable():
    feed_summary = "<p>The company reported a 20% revenue increase in the latest quarter results.</p>"
    result = build_summary(feed_summary, "Company X revenue jumps", "full article text here...")
    assert "20%" in result


def test_build_summary_falls_back_to_generated_summary_when_feed_summary_is_unusable():
    feed_summary = "Company X revenue jumps"  # same as the title -> unusable
    article_text = "The company reported strong quarterly results driven by overseas sales growth."
    result = build_summary(feed_summary, "Company X revenue jumps", article_text)
    assert "overseas sales growth" in result
