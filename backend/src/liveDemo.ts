// LIVE end-to-end demo: one REAL company → real news via EventRegistry MCP → drift detection.
//
//   npm run demo:live                      # defaults to Wirecard AG
//   npm run demo:live -- "Tesla Inc"       # any company
//   npm run demo:live -- "Acme Corp" "Declared business description here"
//
// Needs EVENTREGISTRY_API_KEY in backend/.env for real articles (otherwise it warns and
// falls back). ANTHROPIC_API_KEY makes Stage 2/3 reasoning live; without it, stubs run.
import "dotenv/config";
import { runPipeline } from "./pipeline/pipeline.js";
import { costSummary, isLiveLLM } from "./pipeline/llm.js";
import type { ClientBaseline, RawSignal } from "./types.js";

const companyName = process.argv[2] || "Wirecard AG";
const declaredBusiness =
  process.argv[3] ||
  "Digital payments processor and financial-technology company providing online payment processing and card-issuing services to merchants across Europe.";

// Synthetic KYC baseline (as if the bank had onboarded this real company).
const baseline: ClientBaseline = {
  clientId: `CLT-${companyName.replace(/\W+/g, "").toUpperCase().slice(0, 10)}`,
  legalName: companyName,
  jurisdiction: "Germany",
  legalForm: "AG",
  onboardingDate: "2018-01-01",
  declaredBusinessDescription: declaredBusiness,
  expectedMonthlyTxCount: 200,
  expectedMonthlyVolumeUSD: 5_000_000,
  expectedCounterpartyRegions: ["European Union", "Germany"],
  ubos: [{ name: "(declared management board)", ownershipPct: 100, isPEP: false }],
  riskRating: "medium",
  isSynthetic: true, // the KYC profile is synthetic; the NEWS is real
  generatedBy: "manual",
};

// A live news signal: no rawText — the pipeline fetches REAL articles for `newsQuery`.
const liveNewsSignal: RawSignal = {
  signalId: `SIG-${baseline.clientId}-NEWS`,
  clientId: baseline.clientId,
  category: "negative_news",
  detectedAt: new Date().toISOString().slice(0, 10),
  sourceType: "news",
  newsQuery: companyName,
};

async function main() {
  console.log(`AMINA LIVE demo — real news for: ${companyName}`);
  console.log(`News MCP: ${process.env.EVENTREGISTRY_API_KEY ? "LIVE (EventRegistry)" : "NO KEY → fallback"}`);
  console.log(`LLM: ${isLiveLLM() ? "LIVE" : "STUB"}`);
  console.log("─".repeat(72));

  const result = await runPipeline(baseline, [], [liveNewsSignal]);

  console.log(`\nClient: ${baseline.legalName} [${baseline.clientId}]  (KYC profile synthetic, news real)`);
  console.log(`Declared: ${baseline.declaredBusinessDescription}`);
  console.log(`\nFlag: ${result.composite.riskFlag.toUpperCase()}  Score: ${result.composite.compositeScore}/100`);

  console.log("\nStage trace:");
  for (const t of result.stageTrace) console.log(`  • ${t}`);

  const evidence = result.evidenceBySignal[liveNewsSignal.signalId] ?? [];
  console.log(`\nReal articles retrieved (${evidence.length}):`);
  for (const e of evidence.slice(0, 5)) {
    console.log(`  • ${e.sourceUrl}`);
    console.log(`    ${e.text.slice(0, 160)}…`);
  }

  for (const s of result.composite.contributingSignals) {
    console.log(`\nClassification: ${s.direction} (magnitude ${s.magnitude}, confidence ${s.confidence})`);
    console.log(`  ${s.rationale}`);
    console.log(`  citations: ${s.sourceCitations.join(", ")}`);
  }

  if (result.deepAnalysis) {
    console.log(`\nDeep analysis: ${result.deepAnalysis.summary}`);
    console.log(`Recommended: ${result.deepAnalysis.recommendedAction}`);
  }

  const cost = costSummary();
  console.log(`\nCost: ${cost.calls} LLM call(s), $${cost.totalUSD.toFixed(6)} total.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
