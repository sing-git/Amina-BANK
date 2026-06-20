// End-to-end with TEAM data: KYC db (Alice/team) + news drift signals (Giulio)
// → our scoring pipeline. `npm run demo:ingest`.
import "dotenv/config";
import { loadBaselines } from "./ingest/kycAdapter.js";
import { loadDriftSignals } from "./ingest/newsAdapter.js";
import { runPipeline } from "./pipeline/pipeline.js";

async function main() {
  const baselines = loadBaselines();
  const signalsByClient = loadDriftSignals();
  const haveSignals = Object.keys(signalsByClient).length;

  console.log(`Loaded ${baselines.length} KYC baselines from data/kyc_database.json`);
  console.log(
    haveSignals
      ? `Loaded drift signals for ${haveSignals} companies from kyc_drift_signals.json`
      : "No kyc_drift_signals.json yet (run scrapers/news-feed signal_extractor.py) — scoring with empty signals",
  );
  console.log("─".repeat(72));

  for (const b of baselines) {
    const signals = signalsByClient[b.clientId] ?? [];
    const result = await runPipeline(b, [], signals);
    const flag = result.composite.riskFlag.toUpperCase();
    console.log(`${flag.padEnd(8)} ${result.composite.compositeScore.toString().padStart(3)}/100  ${b.legalName}  (${signals.length} news signal)`);
    for (const s of result.composite.contributingSignals) {
      console.log(`            • ${s.category} (m${s.magnitude}/c${s.confidence}) — ${s.rationale.slice(0, 90)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
