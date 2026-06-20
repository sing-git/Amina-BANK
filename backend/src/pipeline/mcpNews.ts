// Evidence retrieval (Layer 1 live source). Wraps EventRegistry news MCP behind a
// single function so the frontend never touches the news API or its key.
// Falls back to the signal's own rawText/sourceUrl when no key is set.
import type { RawSignal } from "../types.js";

export interface Evidence {
  sourceUrl: string;
  text: string;
}

export async function fetchEvidenceViaMCP(signal: RawSignal): Promise<Evidence[]> {
  const key = process.env.EVENTREGISTRY_API_KEY;
  // The keyword we search news for: an explicit newsQuery (live company demo) or the rawText.
  const keyword = (signal.newsQuery ?? signal.rawText ?? "").trim();

  const fallback = (): Evidence[] =>
    signal.rawText
      ? [{ sourceUrl: signal.sourceUrl ?? `signal:${signal.signalId}`, text: signal.rawText }]
      : [];

  // No key, or non-news signal → use whatever the signal already carries.
  if (!key || signal.sourceType !== "news" || !keyword) {
    return fallback();
  }

  // Live EventRegistry (newsapi.ai) query, keyed off the company name / signal text.
  try {
    const res = await fetch("https://eventregistry.org/api/v1/article/getArticles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "getArticles",
        keyword,
        keywordOper: "and",
        lang: "eng",
        articlesPage: 1,
        articlesCount: 5,
        articlesSortBy: "date",
        resultType: "articles",
        dataType: ["news"],
        apiKey: key,
      }),
    });
    if (!res.ok) throw new Error(`EventRegistry ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      articles?: { results?: Array<{ url: string; title: string; body?: string; date?: string }> };
    };
    const results = data.articles?.results ?? [];
    if (results.length === 0) return fallback();
    return results.map((a) => ({
      sourceUrl: a.url,
      text: `${a.date ? `(${a.date}) ` : ""}${a.title}. ${(a.body ?? "").slice(0, 500)}`,
    }));
  } catch (e) {
    console.warn(`[mcpNews] live fetch failed (${(e as Error).message}); using fallback text.`);
    return fallback();
  }
}
