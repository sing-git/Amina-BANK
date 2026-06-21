// LLM wrapper with three modes, picked automatically:
//   ollama    — local model (e.g. gemma3:4b), FREE. Set OLLAMA_MODEL in .env.
//   anthropic — Claude Haiku/Sonnet. Set ANTHROPIC_API_KEY.
//   stub      — deterministic fallback (no key, no local model). Keeps demos working.
// Priority: ollama > anthropic > stub. Any live call that errors falls back to the stub
// so the pipeline never crashes mid-demo.
import Anthropic from "@anthropic-ai/sdk";
import type { CostLogEntry } from "../types.js";

// USD per 1M tokens. Models not listed (local ones) cost $0 automatically.
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5-20251001": { in: 1.0, out: 5.0 },
  "claude-sonnet-4-6": { in: 3.0, out: 15.0 },
  "gemini-2.5-flash-lite": { in: 0.1, out: 0.4 },
  "gemini-3.1-flash-lite": { in: 0.1, out: 0.4 },
};

const OLLAMA_MODEL = process.env.OLLAMA_MODEL; // e.g. "gemma3:4b" — set this to run free
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434/api/generate";

// Apertus — Swiss sovereign open LLM (EPFL/ETH/CSCS). OpenAI-compatible API. A strong
// data-sovereignty story for a Swiss bank: reasoning stays on a Swiss/European model.
const APERTUS_BASE_URL = process.env.APERTUS_BASE_URL ?? "https://api.publicai.co/v1";
const APERTUS_MODEL = process.env.APERTUS_MODEL ?? "swiss-ai/apertus-70b-instruct";

// Gemini — Google Generative Language API (AI Studio key). Cheap/fast flash-lite tier.
const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite";

export const costLog: CostLogEntry[] = [];

function nowISO(): string {
  return new Date().toISOString();
}

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export type LLMMode = "ollama" | "anthropic" | "apertus" | "gemini" | "stub";

// Default (auto) mode: ollama if a local model is set, else anthropic, else stub.
export function llmMode(): LLMMode {
  if (OLLAMA_MODEL) return "ollama";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.APERTUS_API_KEY) return "apertus"; // Swiss sovereign LLM as default reasoning
  return "stub";
}

// Per-stage mode for the hybrid setup. STAGE2_PROVIDER / STAGE3_PROVIDER can force
// "ollama" | "anthropic" | "stub"; unset (or "auto") falls back to llmMode().
// Hybrid example: OLLAMA_MODEL=gemma3:4b + STAGE3_PROVIDER=anthropic + ANTHROPIC_API_KEY=...
//   → Stage 2 free (gemma), Stage 3 high-quality (Claude).
export function stageMode(stage: 2 | 3): LLMMode {
  const override = (stage === 2 ? process.env.STAGE2_PROVIDER : process.env.STAGE3_PROVIDER)?.toLowerCase();
  if (override === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (override === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  if (override === "apertus" && process.env.APERTUS_API_KEY) return "apertus";
  if (override === "ollama" && OLLAMA_MODEL) return "ollama";
  if (override === "stub") return "stub";
  return llmMode();
}

export function isLiveLLM(): boolean {
  return llmMode() !== "stub";
}

function logCost(stage: 2 | 3, model: string, inputTokens: number, outputTokens: number, signalId: string): void {
  const price = PRICING[model] ?? { in: 0, out: 0 }; // local model → $0
  costLog.push({
    stage,
    model,
    inputTokens,
    outputTokens,
    estimatedCostUSD: (inputTokens * price.in + outputTokens * price.out) / 1_000_000,
    signalId,
    timestamp: nowISO(),
  });
}

async function callAnthropic(model: string, system: string, user: string, maxTokens: number) {
  const c = getClient()!;
  const res = await c.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  return { text, model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
}

async function callApertus(system: string, user: string, maxTokens: number) {
  const res = await fetch(`${APERTUS_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.APERTUS_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: APERTUS_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) throw new Error(`Apertus ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: data.choices[0]!.message.content,
    model: APERTUS_MODEL,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

const GEMINI_MAX_RETRIES = Number(process.env.GEMINI_MAX_RETRIES ?? 5);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callGeminiOnce(system: string, user: string, maxTokens: number) {
  const res = await fetch(`${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: maxTokens, responseMimeType: "application/json" },
    }),
  });
  if (res.status === 429 || res.status >= 500) {
    // retryable: rate limit or transient server error. Honor server retry hint if present.
    const body = await res.text();
    const hint = Number(body.match(/retry in ([0-9.]+)s/i)?.[1]);
    const err = new Error(`Gemini ${res.status}: ${body.slice(0, 120)}`) as Error & { retryMs?: number };
    err.retryMs = Number.isFinite(hint) ? Math.ceil(hint * 1000) : undefined;
    throw err;
  }
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error(`Gemini returned no text: ${JSON.stringify(data).slice(0, 200)}`);
  return {
    text,
    model: GEMINI_MODEL,
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

// Retry transient failures (network "fetch failed", 429 rate limit, 5xx) with backoff so a
// one-shot generation run completes cleanly instead of falling back to the stub.
async function callGemini(system: string, user: string, maxTokens: number) {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt++) {
    try {
      return await callGeminiOnce(system, user, maxTokens);
    } catch (e) {
      lastErr = e;
      if (attempt === GEMINI_MAX_RETRIES) break;
      const hinted = (e as { retryMs?: number }).retryMs;
      const backoff = hinted ?? Math.min(1000 * 2 ** attempt, 8000);
      await sleep(backoff + Math.floor(Math.random() * 250));
    }
  }
  throw lastErr;
}

async function callOllama(model: string, system: string, user: string, maxTokens: number) {
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      system,
      prompt: user,
      format: "json", // gemma returns valid JSON in this mode
      stream: false,
      options: { num_predict: maxTokens },
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { response: string; prompt_eval_count?: number; eval_count?: number };
  return { text: data.response, model, inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 };
}

/**
 * Calls the active model. Falls back to `stub()` on no-config or any error, logging an
 * estimated token count so the cost table still populates.
 */
export async function callLLM(opts: {
  stage: 2 | 3;
  model: string; // anthropic model id; ignored in ollama mode (OLLAMA_MODEL used instead)
  system: string;
  user: string;
  maxTokens: number;
  signalId: string;
  stub: () => string;
}): Promise<{ text: string; live: boolean }> {
  const mode = stageMode(opts.stage);

  if (mode !== "stub") {
    try {
      const r =
        mode === "ollama"
          ? await callOllama(OLLAMA_MODEL!, opts.system, opts.user, opts.maxTokens)
          : mode === "apertus"
            ? await callApertus(opts.system, opts.user, opts.maxTokens)
            : mode === "gemini"
              ? await callGemini(opts.system, opts.user, opts.maxTokens)
              : await callAnthropic(opts.model, opts.system, opts.user, opts.maxTokens);
      logCost(opts.stage, r.model, r.inputTokens, r.outputTokens, opts.signalId);
      return { text: r.text, live: true };
    } catch (e) {
      console.warn(`[llm] ${mode} call failed (${(e as Error).message}); using stub.`);
    }
  }

  const text = opts.stub();
  logCost(
    opts.stage,
    mode === "ollama"
      ? (OLLAMA_MODEL ?? "ollama")
      : mode === "apertus"
        ? APERTUS_MODEL
        : mode === "gemini"
          ? GEMINI_MODEL
          : opts.model,
    Math.ceil((opts.system.length + opts.user.length) / 4),
    Math.ceil(text.length / 4),
    opts.signalId,
  );
  return { text, live: false };
}

/** Extract the first JSON object from a model response (tolerates stray prose/fences). */
export function extractJSON<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`No JSON object in model output: ${text.slice(0, 200)}`);
  const raw = candidate.slice(start, end + 1);
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Some models (e.g. Apertus 70B) emit trailing commas before } or ] — strip and retry.
    const repaired = raw.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(repaired) as T;
  }
}

export function costSummary() {
  const totalUSD = costLog.reduce((s, e) => s + e.estimatedCostUSD, 0);
  const byStage = { 2: 0, 3: 0 } as Record<2 | 3, number>;
  for (const e of costLog) byStage[e.stage] += e.estimatedCostUSD;
  return {
    mode: llmMode(),
    calls: costLog.length,
    totalUSD,
    stage2USD: byStage[2],
    stage3USD: byStage[3],
    costPer1000USD: costLog.length ? (totalUSD / costLog.length) * 1000 : 0,
    entries: costLog,
  };
}
