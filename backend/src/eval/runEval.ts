// Evaluation harness. `npm run eval`.
// Runs each labeled case through the pipeline and checks the prediction against the
// injected ground-truth label → prints a PASS/FAIL table + accuracy. Keyless (stubs).
import "dotenv/config";
import { runPipeline } from "../pipeline/pipeline.js";
import { LABELED_CASES, type LabeledCase } from "./labeledCases.js";
import type { RiskFlag } from "../types.js";

const RANK: Record<RiskFlag, number> = { low: 0, medium: 1, high: 2, critical: 3 };

async function checkCase(c: LabeledCase): Promise<{ pass: boolean; got: string; reasons: string[] }> {
  const result = await runPipeline(c.baseline, c.txs, c.signals);
  const flag = result.composite.riskFlag;
  const cats = result.composite.contributingSignals.map((s) => s.category);
  const reasons: string[] = [];

  if (c.expect.minFlag && RANK[flag] < RANK[c.expect.minFlag]) reasons.push(`flag ${flag} < min ${c.expect.minFlag}`);
  if (c.expect.maxFlag && RANK[flag] > RANK[c.expect.maxFlag]) reasons.push(`flag ${flag} > max ${c.expect.maxFlag}`);
  for (const cat of c.expect.categories ?? []) {
    if (!cats.includes(cat)) reasons.push(`missing category ${cat}`);
  }
  if (c.expect.fraud && !result.composite.contributingSignals.some((s) => s.isFraudTypology)) {
    reasons.push("expected a fraud typology, none found");
  }

  const got = `flag=${flag}${cats.length ? `, signals=[${cats.join(", ")}]` : ""}`;
  return { pass: reasons.length === 0, got, reasons };
}

async function main() {
  console.log("AMINA evaluation — predicted vs injected ground-truth label\n");
  let passed = 0;
  for (const c of LABELED_CASES) {
    const { pass, got, reasons } = await checkCase(c);
    if (pass) passed++;
    console.log(`${pass ? "✅ PASS" : "❌ FAIL"}  [${c.scenario}] ${c.name}`);
    console.log(`        expected: ${JSON.stringify(c.expect)}`);
    console.log(`        got:      ${got}`);
    if (!pass) console.log(`        why:      ${reasons.join("; ")}`);
  }
  const pct = ((passed / LABELED_CASES.length) * 100).toFixed(0);
  console.log(`\nAccuracy: ${passed}/${LABELED_CASES.length} (${pct}%) cases matched their ground-truth label.`);
  if (passed < LABELED_CASES.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
