// One-shot portfolio generator.
// Scores all portfolio clients through the live pipeline (Gemini) ONCE and writes the full
// /api/portfolio/alerts payload to data/portfolio_alerts.json. The server then serves that
// cache, so the LLM key is never needed at runtime. Re-run `npm run gen:portfolio` to refresh.
//
// Key resolution: the repo-root .env (paid GEMINI_API_KEY) is loaded first and wins; backend/.env
// fills in STAGE_*_PROVIDER / GEMINI_MODEL. Loaded BEFORE the pipeline is imported (dynamic import
// below) because llm.ts reads GEMINI_MODEL at module-eval time.
import { writeFileSync } from "node:fs";
import { config } from "dotenv";

config({ path: new URL("../../.env", import.meta.url), override: true }); // repo-root .env (paid key)
config(); // backend/.env (providers + model) — does not override the root key
if (process.env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY.trim();

const OUT = new URL("../../data/portfolio_alerts.json", import.meta.url);

async function main() {
  // Dynamic imports so the env above is in place before llm.ts evaluates its module constants.
  const { runPipeline } = await import("./pipeline/pipeline.js");
  const { costSummary } = await import("./pipeline/llm.js");
  const { loadBaselines } = await import("./ingest/kycAdapter.js");
  const { loadDriftSignals } = await import("./ingest/newsAdapter.js");
  const { loadTransactions } = await import("./ingest/txAdapter.js");
  const { loadContagionFlags, contagionFlagToScore } = await import("./ingest/sanctionsFlagsAdapter.js");
  const { loadRegistryDriftScores } = await import("./ingest/corporateAdapter.js");

  console.log(`LLM key: ${process.env.GEMINI_API_KEY ? "present" : "MISSING — will fall back to stub"}`);
  const baselines = loadBaselines();
  const signalsByClient = loadDriftSignals();
  const txByClient = loadTransactions();
  const contagionByClient = loadContagionFlags(baselines);
  const registryByClient = loadRegistryDriftScores(baselines);

  // Mirror the /api/portfolio/alerts handler exactly so the cache is identical to a live run.
  const alerts = [];
  for (const baseline of baselines) {
    const signals = signalsByClient[baseline.clientId] ?? [];
    const txs = txByClient[baseline.clientId] ?? [];
    const withTx = txs.length
      ? [
          ...signals,
          {
            signalId: `tx-trigger-${baseline.clientId}`,
            clientId: baseline.clientId,
            category: "cross_border_anomaly" as const,
            detectedAt: "2026-06-20",
            sourceType: "transaction" as const,
          },
        ]
      : signals;
    const contagion = (contagionByClient[baseline.clientId] ?? []).map((c, i) => contagionFlagToScore(c, i));
    const registry = registryByClient[baseline.clientId] ?? [];
    // Sequential (not Promise.all) to stay well under any LLM rate limit during generation.
    const result = await runPipeline(baseline, txs, withTx, [...contagion, ...registry]);
    alerts.push({ caseName: baseline.legalName, baseline, ...result });
    const flag = result.composite.riskFlag.toUpperCase();
    console.log(`  scored ${baseline.legalName.padEnd(36)} ${flag} ${result.composite.compositeScore}/100`);
  }

  const payload = { alerts, cost: costSummary(), source: "cached", generatedAt: new Date().toISOString() };
  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  const stubCount = alerts
    .flatMap((a) => [...a.composite.contributingSignals, ...a.composite.neutralSignals])
    .filter((s) => /\[STUB/.test(s.rationale)).length;
  console.log(`\nWrote ${alerts.length} clients → data/portfolio_alerts.json`);
  console.log(`LLM mode: ${payload.cost.mode} · calls: ${payload.cost.calls} · stub-fallback signals: ${stubCount}`);
}

main().catch((e) => {
  console.error("gen:portfolio failed:", e);
  process.exit(1);
});
