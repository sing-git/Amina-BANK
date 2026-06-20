// Narrative-signal embeddings. Two interchangeable backends behind one signature:
//   embed(text) -> number[]
// Option B (default): simpleEmbed — hashing-based, zero key, runs anywhere.
// Option A (upgrade): voyageEmbed — real semantic vectors, needs VOYAGE_API_KEY
//                     (backend-only; never exposed to the browser).
// See runbook D4.
import { POLICY } from "./policy.js";

const EMBED_DIM = 256;

/**
 * Option B — deterministic hashing-based embedding. No network, no key.
 * Maps tokens into a fixed-width vector via a cheap hash, then L2-normalizes.
 * Good enough to demonstrate "similar text → high cosine" without infra.
 */
export function simpleEmbed(text: string): number[] {
  const vec = new Array<number>(EMBED_DIM).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  for (const token of tokens) {
    let h = 2166136261; // FNV-1a basis
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % EMBED_DIM;
    const sign = (h & 1) === 0 ? 1 : -1;
    vec[idx] = (vec[idx] ?? 0) + sign;
  }

  // L2 normalize so cosine similarity is well-behaved
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/**
 * Option A — Voyage AI. BACKEND ONLY. Reads VOYAGE_API_KEY from env.
 */
export async function voyageEmbed(text: string): Promise<number[]> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY not set — use simpleEmbed instead");
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: text, model: "voyage-3-lite" }),
  });
  if (!res.ok) throw new Error(`Voyage error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return data.data[0]!.embedding;
}

/**
 * Unified entry point. Uses Voyage when a key is present, else simpleEmbed.
 * The rest of the pipeline only ever calls this — swapping backends is invisible.
 */
export async function embed(text: string): Promise<number[]> {
  if (process.env.VOYAGE_API_KEY) {
    try {
      return await voyageEmbed(text);
    } catch {
      // graceful fallback for the demo — never let embeddings hard-fail the pipeline
      return simpleEmbed(text);
    }
  }
  return simpleEmbed(text);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((s, ai, i) => s + ai * (b[i] ?? 0), 0);
  const normA = Math.sqrt(a.reduce((s, ai) => s + ai * ai, 0));
  const normB = Math.sqrt(b.reduce((s, bi) => s + bi * bi, 0));
  if (normA === 0 || normB === 0) return 0;
  return dot / (normA * normB);
}

/**
 * Receives PRE-CACHED baseline + archetype vectors; only embeds the live signal text.
 * See runbook D4 caching table.
 */
export async function scoreNarrativeSignal(
  baselineEmbedding: number[],
  archetypeEmbeddings: Record<string, number[]>,
  currentText: string,
): Promise<{
  baselineSimilarity: number;
  archetypeMatches: Array<{ archetype: string; similarity: number }>;
}> {
  const currentEmbedding = await embed(currentText);
  const baselineSimilarity = cosineSimilarity(baselineEmbedding, currentEmbedding);
  const archetypeMatches = Object.entries(archetypeEmbeddings)
    .map(([archetype, vec]) => ({ archetype, similarity: cosineSimilarity(vec, currentEmbedding) }))
    .sort((a, b) => b.similarity - a.similarity);
  return { baselineSimilarity, archetypeMatches };
}

// Fixed risk archetypes come from the compliance-owned policy (config/riskPolicy.json).
export const RISK_ARCHETYPES: Record<string, string> = POLICY.riskArchetypes;

/** Build the cached archetype vectors once at startup. */
export async function buildArchetypeEmbeddings(): Promise<Record<string, number[]>> {
  const out: Record<string, number[]> = {};
  for (const [name, text] of Object.entries(RISK_ARCHETYPES)) {
    out[name] = await embed(text);
  }
  return out;
}
