// REST API for the frontend dashboard. Holds all secrets; frontend calls these endpoints.
import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import express from "express";
import cors from "cors";
import { runPipeline } from "./pipeline/pipeline.js";
import { costSummary, isLiveLLM } from "./pipeline/llm.js";
import { demoCases } from "./data/sampleData.js";
import { loadBaselines } from "./ingest/kycAdapter.js";
import { loadDriftSignals } from "./ingest/newsAdapter.js";
import { loadContagionFlags, contagionFlagToScore } from "./ingest/sanctionsFlagsAdapter.js";
import { loadRegistryDriftScores } from "./ingest/corporateAdapter.js";
import { loadAllBaselines, loadAllSignals, pingDb } from "./db.js";
import type { ClientBaseline, RawSignal, TransactionRecord } from "./types.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors({ origin: (process.env.CORS_ORIGIN ?? "*").split(",") }));

// In-memory audit log + human-decision store (swap for a DB in production).
interface AuditEntry {
  ts: string;
  clientId: string;
  actor: string;
  action: string;
  detail: string;
}
const auditLog: AuditEntry[] = [];

// Landing page so hitting the backend root in a browser isn't a scary "Cannot GET /".
app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html><html><head><meta charset="utf-8">
<title>AMINA backend</title>
<style>body{font-family:-apple-system,sans-serif;background:#0f1115;color:#e6e8ec;max-width:640px;margin:40px auto;padding:0 20px}
a{color:#4a7dff}code{background:#1d212a;padding:2px 6px;border-radius:4px}</style></head><body>
<h2>◆ AMINA backend is running</h2>
<p>This is the API server — there is no page here. The dashboard is the frontend (<code>http://localhost:5173</code>).</p>
<p>Endpoints:</p>
<ul>
<li><a href="/api/health">/api/health</a> — status</li>
<li><a href="/api/demo/alerts">/api/demo/alerts</a> — 3 demo cases</li>
<li><a href="/api/portfolio/alerts">/api/portfolio/alerts</a> — team portfolio</li>
<li><a href="/api/sanctions-flags">/api/sanctions-flags</a> — sanctions screening flags</li>
<li><a href="/api/registry-drift">/api/registry-drift</a> — corporate registry drift</li>
<li><a href="/api/cost">/api/cost</a> — cost readout</li>
<li><a href="/api/audit">/api/audit</a> — audit log</li>
</ul></body></html>`);
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, llm: isLiveLLM() ? "live" : "stub", time: new Date().toISOString() });
});

// Run the 3 built-in demo cases (handy for the dashboard's initial queue).
app.get("/api/demo/alerts", async (_req, res) => {
  const alerts = [];
  for (const c of demoCases) {
    const result = await runPipeline(c.baseline, c.txs, c.signals);
    alerts.push({ caseName: c.name, baseline: c.baseline, ...result });
  }
  res.json({ alerts, cost: costSummary() });
});

// Real portfolio: team KYC db (data/kyc_database.json) + Giulio's news drift signals,
// each scored through the pipeline. This is the integrated end-to-end view.
app.get("/api/portfolio/alerts", async (_req, res) => {
  try {
    // Prefer Postgres (the scrapers→DB→API loop); fall back to reading the JSON files directly.
    let baselines;
    let signalsByClient;
    let source: string;
    if (process.env.DATABASE_URL && (await pingDb())) {
      baselines = await loadAllBaselines();
      signalsByClient = await loadAllSignals();
      source = "postgres";
    } else {
      baselines = loadBaselines();
      signalsByClient = loadDriftSignals();
      source = "json-files";
    }
    // Deterministic pre-scored signals (authoritative facts, no LLM judgement):
    //  - sanctions contagion: a linked entity in a customer's news is on a list (counterparty
    //    exposure on THAT customer — does not auto-CRITICAL; that's the hard gate's job).
    //  - registry drift: live registry status/jurisdiction/officer changes vs. the KYC baseline.
    const contagionByClient = loadContagionFlags(baselines);
    const registryByClient = loadRegistryDriftScores(baselines);

    const alerts = [];
    for (const baseline of baselines) {
      const signals = signalsByClient[baseline.clientId] ?? [];
      const contagion = (contagionByClient[baseline.clientId] ?? []).map((c, i) => contagionFlagToScore(c, i));
      const registry = registryByClient[baseline.clientId] ?? [];
      const result = await runPipeline(baseline, [], signals, [...contagion, ...registry]);
      alerts.push({ caseName: baseline.legalName, baseline, ...result });
    }
    res.json({ alerts, cost: costSummary(), source });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Score an arbitrary client (frontend or generators POST here).
app.post("/api/score", async (req, res) => {
  try {
    const { baseline, txs, signals } = req.body as {
      baseline: ClientBaseline;
      txs: TransactionRecord[];
      signals: RawSignal[];
    };
    const result = await runPipeline(baseline, txs ?? [], signals ?? []);
    res.json({ ...result, cost: costSummary() });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// Human-in-the-loop: analyst approves/rejects an alert (stagegate — explicit action only).
app.post("/api/decision", (req, res) => {
  const { clientId, actor, action, detail } = req.body as {
    clientId: string;
    actor: string;
    action: "approve" | "reject" | "escalate";
    detail?: string;
  };
  if (!clientId || !actor || !action) {
    return res.status(400).json({ error: "clientId, actor and action are required" });
  }
  const entry: AuditEntry = {
    ts: new Date().toISOString(),
    clientId,
    actor,
    action,
    detail: detail ?? "",
  };
  auditLog.push(entry);
  res.json({ ok: true, entry });
});

// Raw drift signals (scrapers/news-feed/kyc_drift_signals.json) for the Clusters view.
// Served verbatim — the frontend builds the hub-and-spoke graph from this shape.
app.get("/api/drift-signals", (_req, res) => {
  try {
    const path = new URL("../../scrapers/news-feed/kyc_drift_signals.json", import.meta.url);
    if (!existsSync(path)) return res.json({ companies: [] });
    const companies = JSON.parse(readFileSync(path, "utf8"));
    res.json({ companies });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// KYC database (docs/kyc_database.json) — the onboarding baselines for each client.
// Served verbatim for the Onboarding view.
app.get("/api/kyc-database", (_req, res) => {
  try {
    const path = new URL("../../docs/kyc_database.json", import.meta.url);
    if (!existsSync(path)) return res.json({ companies: [] });
    const companies = JSON.parse(readFileSync(path, "utf8"));
    res.json({ companies: Array.isArray(companies) ? companies : [] });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Sanctions screening flags (scrapers/sanctions/kyc_sanctions_flags.json) for the Clusters
// contagion overlay. Served verbatim — the frontend matches flagged names against graph leaves.
app.get("/api/sanctions-flags", (_req, res) => {
  try {
    const path = new URL("../../scrapers/sanctions/kyc_sanctions_flags.json", import.meta.url);
    if (!existsSync(path)) return res.json({ flags: [] });
    const data = JSON.parse(readFileSync(path, "utf8"));
    res.json({ flags: data.flags ?? [] });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Corporate registry drift report (scrapers/corporate/kyc_drift_report.json) for the Clusters
// view — drift-detected companies turn their cluster red; healthy companies show nothing.
app.get("/api/registry-drift", (_req, res) => {
  try {
    const path = new URL("../../scrapers/corporate/kyc_drift_report.json", import.meta.url);
    if (!existsSync(path)) return res.json({ report: [] });
    const report = JSON.parse(readFileSync(path, "utf8"));
    res.json({ report: Array.isArray(report) ? report : [] });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get("/api/audit", (_req, res) => res.json({ auditLog }));
app.get("/api/cost", (_req, res) => res.json(costSummary()));

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => {
  console.log(`AMINA backend on http://localhost:${PORT}  (LLM: ${isLiveLLM() ? "live" : "stub"})`);
});
