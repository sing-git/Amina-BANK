-- AMINA database schema. Run once: `npm run db:init` (or `psql amina -f backend/schema.sql`).

CREATE TABLE IF NOT EXISTS signals (
  id           SERIAL PRIMARY KEY,
  client_id    TEXT NOT NULL,
  category     TEXT NOT NULL,
  source_type  TEXT NOT NULL,
  source_url   TEXT,
  raw_text     TEXT,
  detected_at  TIMESTAMPTZ NOT NULL,
  fetched_at   TIMESTAMPTZ DEFAULT now()   -- for tracking the 24h refresh cycle
);

CREATE INDEX IF NOT EXISTS idx_signals_client ON signals (client_id);

CREATE TABLE IF NOT EXISTS kyc_baselines (
  client_id  TEXT PRIMARY KEY,
  data       JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS decisions (
  id         SERIAL PRIMARY KEY,
  client_id  TEXT,
  actor      TEXT,
  action     TEXT,
  detail     TEXT,
  ts         TIMESTAMPTZ DEFAULT now()
);
