// Creates the tables. Run: `npm run db:init` (needs Postgres running + DATABASE_URL set).
import "dotenv/config";
import { readFileSync } from "node:fs";
import { pool, pingDb } from "./db.js";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set in backend/.env — see backend/DATABASE.md");
    process.exit(1);
  }
  if (!(await pingDb())) {
    console.error("Cannot reach Postgres. Is it running? (brew services start postgresql@16) — see DATABASE.md");
    process.exit(1);
  }
  const sql = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
  await pool.query(sql);
  console.log("✓ tables created (signals, kyc_baselines, decisions)");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
