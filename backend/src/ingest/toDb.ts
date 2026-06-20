// Ingest the latest scraper outputs into Postgres (one refresh cycle).
// Reads KYC baselines + news drift signals via the adapters and writes them to the DB.
// Signals are fully refreshed each cycle (delete + re-insert) so `fetched_at` reflects the
// last 24h pull.
import { clearSignals, saveBaseline, saveSignal } from "../db.js";
import { loadBaselines } from "./kycAdapter.js";
import { loadDriftSignals } from "./newsAdapter.js";

export async function ingestToDb(): Promise<{ baselines: number; signals: number }> {
  const baselines = loadBaselines();
  const signalsByClient = loadDriftSignals();

  for (const b of baselines) await saveBaseline(b);

  await clearSignals(); // full refresh
  let signals = 0;
  for (const list of Object.values(signalsByClient)) {
    for (const s of list) {
      await saveSignal(s);
      signals += 1;
    }
  }
  return { baselines: baselines.length, signals };
}
