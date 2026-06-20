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
};

const OLLAMA_MODEL = process.env.OLLAMA_MODEL; // e.g. "gemma3:4b" — set this to run free
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434/api/generate";

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

export type LLMMode = "ollama" | "anthropic" | "stub";

export function llmMode(): LLMMode {
  if (OLLAMA_MODEL) return "ollama";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "stub";
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
  const mode = llmMode();

  if (mode !== "stub") {
    try {
      const r =
        mode === "ollama"
          ? await callOllama(OLLAMA_MODEL!, opts.system, opts.user, opts.maxTokens)
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
    mode === "ollama" ? (OLLAMA_MODEL ?? "ollama") : opts.model,
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
  return JSON.parse(candidate.slice(start, end + 1)) as T;
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
