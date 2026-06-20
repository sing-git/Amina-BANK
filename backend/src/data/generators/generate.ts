// Multi-model synthetic data generator. `npm run generate`.
// Fans a set of seeds across EVERY provider that has a key, tags each record with
// `generatedBy`, and writes one combined dataset. Diversity = no single-model bias.
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { extractJSON } from "../../pipeline/llm.js";
import type { ClientBaseline, SyntheticModel, TransactionRecord } from "../../types.js";
import { buildGenUser, GEN_SYSTEM, type GenSeed } from "./prompt.js";
import { providers } from "./providers.js";

const SEEDS: GenSeed[] = [
  { sector: "B2B SaaS invoicing software", jurisdiction: "Germany", scenario: "normal" },
  { sector: "on-chain crypto derivatives", jurisdiction: "United States", scenario: "pivot" },
  { sector: "import/export commodities trading", jurisdiction: "Cyprus", scenario: "structuring" },
  { sector: "regional logistics company", jurisdiction: "United Arab Emirates", scenario: "dormancy_break" },
  { sector: "boutique wealth management", jurisdiction: "Switzerland", scenario: "normal" },
];

interface GenRecord {
  baseline: Omit<ClientBaseline, "isSynthetic" | "generatedBy">;
  transactions: Array<Omit<TransactionRecord, "isSynthetic" | "generatedBy" | "clientId">>;
}

async function main() {
  const active = providers.filter((p) => p.available());
  if (active.length === 0) {
    console.error(
      "No provider keys found. Set at least one of ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY / AZURE_OPENAI_API_KEY in backend/.env.",
    );
    process.exit(1);
  }
  console.log(`Generating with ${active.length} model(s): ${active.map((p) => p.id).join(", ")}`);

  const clients: ClientBaseline[] = [];
  const transactions: TransactionRecord[] = [];
  const labelByClientId: Record<string, string> = {}; // clientId → injected scenario (ground truth)

  for (const seed of SEEDS) {
    for (const provider of active) {
      try {
        const raw = await provider.generate(GEN_SYSTEM, buildGenUser(seed));
        const parsed = extractJSON<GenRecord>(raw);

        const clientId = `${parsed.baseline.clientId || "CLT"}-${provider.id}`.toUpperCase();
        const baseline: ClientBaseline = {
          ...parsed.baseline,
          clientId,
          isSynthetic: true,
          generatedBy: provider.id as SyntheticModel,
        };
        clients.push(baseline);
        labelByClientId[clientId] = seed.scenario; // record the ground-truth label

        parsed.transactions.forEach((t, i) => {
          transactions.push({
            ...t,
            txId: `${clientId}-T${i + 1}`,
            clientId,
            isSynthetic: true,
            generatedBy: provider.id as SyntheticModel,
          });
        });
        console.log(`  ✓ ${provider.id.padEnd(7)} ${seed.scenario.padEnd(14)} → ${baseline.legalName}`);
      } catch (e) {
        console.warn(`  ✗ ${provider.id} failed on "${seed.sector}": ${(e as Error).message}`);
      }
    }
  }

  const outDir = new URL("../generated/", import.meta.url);
  mkdirSync(outDir, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    models: active.map((p) => p.id),
    clientCount: clients.length,
    // groundTruth: which scenario was injected per client → the label to evaluate against.
    // (CLT id ends in the model name; the SEEDS array order maps clients to scenarios.)
    groundTruth: clients.map((c) => ({ clientId: c.clientId, scenario: labelByClientId[c.clientId] ?? "unknown" })),
    clients,
    transactions,
  };
  writeFileSync(new URL("dataset.json", outDir), JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${clients.length} clients / ${transactions.length} txs → data/generated/dataset.json`);

  // model-diversity summary (a nice slide stat)
  const byModel: Record<string, number> = {};
  for (const c of clients) byModel[c.generatedBy ?? "?"] = (byModel[c.generatedBy ?? "?"] ?? 0) + 1;
  console.log("Diversity:", byModel);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
