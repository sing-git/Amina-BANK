// One-shot ingestion into Postgres. `npm run db:ingest`.
import "dotenv/config";
import { pingDb, pool } from "./db.js";
import { ingestToDb } from "./ingest/toDb.js";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set — see backend/DATABASE.md");
    process.exit(1);
  }
  if (!(await pingDb())) {
    console.error("Cannot reach Postgres. Is it running? (see backend/DATABASE.md)");
    process.exit(1);
  }
  const r = await ingestToDb();
  console.log(`Ingested ${r.baselines} baselines and ${r.signals} signals into Postgres.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
