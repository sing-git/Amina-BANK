// REST API for the frontend dashboard. Holds all secrets; frontend calls these endpoints.
import "dotenv/config";
import express from "express";
import cors from "cors";
import { runPipeline } from "./pipeline/pipeline.js";
import { costSummary, isLiveLLM } from "./pipeline/llm.js";
import { demoCases } from "./data/sampleData.js";
import { loadBaselines } from "./ingest/kycAdapter.js";
import { loadDriftSignals } from "./ingest/newsAdapter.js";
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
    const baselines = loadBaselines();
    const signalsByClient = loadDriftSignals();
    const alerts = [];
    for (const baseline of baselines) {
      const signals = signalsByClient[baseline.clientId] ?? [];
      const result = await runPipeline(baseline, [], signals);
      alerts.push({ caseName: baseline.legalName, baseline, ...result });
    }
    res.json({ alerts, cost: costSummary(), source: "team-data" });
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

app.get("/api/audit", (_req, res) => res.json({ auditLog }));
app.get("/api/cost", (_req, res) => res.json(costSummary()));

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => {
  console.log(`AMINA backend on http://localhost:${PORT}  (LLM: ${isLiveLLM() ? "live" : "stub"})`);
});
