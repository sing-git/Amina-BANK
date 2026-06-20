// Periodic ingestion into Postgres. `npm run scheduler`.
// Runs once immediately, then every INGEST_INTERVAL_MS (default 24h).
// For testing, set a short interval:  INGEST_INTERVAL_MS=10000 npm run scheduler
import "dotenv/config";
import { pingDb } from "./db.js";
import { ingestToDb } from "./ingest/toDb.js";

const INTERVAL_MS = Number(process.env.INGEST_INTERVAL_MS ?? 86_400_000); // 24h default

async function tick(): Promise<void> {
  try {
    const r = await ingestToDb();
    console.log(`[${new Date().toISOString()}] ingested ${r.baselines} baselines, ${r.signals} signals.`);
  } catch (e) {
    console.error(`[scheduler] ingest failed: ${(e as Error).message}`);
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set — see backend/DATABASE.md");
    process.exit(1);
  }
  if (!(await pingDb())) {
    console.error("Cannot reach Postgres. Is it running? (see backend/DATABASE.md)");
    process.exit(1);
  }
  console.log(`Scheduler started. Interval: ${INTERVAL_MS} ms (~${(INTERVAL_MS / 3_600_000).toFixed(2)} h). Ctrl+C to stop.`);
  await tick(); // run immediately
  setInterval(tick, INTERVAL_MS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
