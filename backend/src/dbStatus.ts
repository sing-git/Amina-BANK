// Show what's in the database. `npm run db:status`.
// Verifies the 24h ingestion actually landed: row counts + latest fetch/update time.
import "dotenv/config";
import { pingDb, pool } from "./db.js";

async function main(): Promise<void> {
  if (!(await pingDb())) {
    console.error("Cannot reach Postgres. Is it running? (see backend/DATABASE.md)");
    process.exit(1);
  }
  const sig = await pool.query("SELECT count(*) AS c, max(fetched_at) AS latest FROM signals");
  const kyc = await pool.query("SELECT count(*) AS c, max(updated_at) AS latest FROM kyc_baselines");
  const dec = await pool.query("SELECT count(*) AS c FROM decisions");

  console.log(`signals:       ${sig.rows[0]?.c ?? 0} rows, latest fetch  ${sig.rows[0]?.latest ?? "—"}`);
  console.log(`kyc_baselines: ${kyc.rows[0]?.c ?? 0} rows, latest update ${kyc.rows[0]?.latest ?? "—"}`);
  console.log(`decisions:     ${dec.rows[0]?.c ?? 0} rows`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
