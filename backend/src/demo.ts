// Runnable end-to-end demo. `npm run demo`.
// Works keyless (uses stubs) and live (set ANTHROPIC_API_KEY / EVENTREGISTRY_API_KEY).
import "dotenv/config";
import { runPipeline } from "./pipeline/pipeline.js";
import { costSummary, llmMode } from "./pipeline/llm.js";
import { demoCases } from "./data/sampleData.js";

function line() {
  console.log("─".repeat(72));
}

async function main() {
  console.log(`AMINA Dynamic Risk Profiling — demo  (LLM: ${llmMode()})`);
  line();

  for (const c of demoCases) {
    console.log(`\n### ${c.name}`);
    const result = await runPipeline(c.baseline, c.txs, c.signals);
    console.log(`Client: ${c.baseline.legalName}  [${c.baseline.clientId}]  (synthetic)`);
    console.log(`Flag: ${result.composite.riskFlag.toUpperCase()}  Score: ${result.composite.compositeScore}/100`);
    console.log("Stage trace:");
    for (const t of result.stageTrace) console.log(`  • ${t}`);
    if (result.composite.contributingSignals.length) {
      console.log("Contributing signals:");
      for (const s of result.composite.contributingSignals) {
        console.log(`  • [${s.category}] ${s.direction} (m${s.magnitude}/c${s.confidence}) — ${s.rationale}`);
      }
    }
    if (result.deepAnalysis) {
      console.log("Deep analysis (Stage 3):");
      console.log(`  Summary: ${result.deepAnalysis.summary}`);
      console.log(`  Recommended action: ${result.deepAnalysis.recommendedAction}`);
    }
    line();
  }

  const cost = costSummary();
  console.log("\n### Cost readout");
  console.log(`  LLM calls: ${cost.calls}`);
  console.log(`  Total: $${cost.totalUSD.toFixed(6)}  (Stage 2 $${cost.stage2USD.toFixed(6)}, Stage 3 $${cost.stage3USD.toFixed(6)})`);
  console.log(`  Est. cost per 1,000 analyses: $${cost.costPer1000USD.toFixed(2)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
