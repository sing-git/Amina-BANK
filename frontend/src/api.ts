import type { Alert, AuditEntry, Cost } from "./types";
import { SEED_ALERTS, SEED_COST } from "./seed";
import type { RawCompany } from "./clusters/graph";
import bundledDriftSignals from "./data/kyc_drift_signals.json";

// Calls the backend via the Vite proxy (/api → :8787). If the backend is
// unreachable, transparently falls back to bundled seed data so the demo
// always renders. `live` tells the UI which mode it's in.
export interface AlertsResponse {
  alerts: Alert[];
  cost: Cost;
  live: boolean;
}

export type DataSource = "demo" | "portfolio";

export async function fetchAlerts(source: DataSource = "demo"): Promise<AlertsResponse> {
  const path = source === "portfolio" ? "/api/portfolio/alerts" : "/api/demo/alerts";
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { alerts: Alert[]; cost: Cost };
    return { ...data, live: true };
  } catch {
    // portfolio has no offline fallback; demo falls back to bundled seed data
    return { alerts: source === "portfolio" ? [] : SEED_ALERTS, cost: SEED_COST, live: false };
  }
}

export async function postDecision(body: {
  clientId: string;
  actor: string;
  action: string; // "approve"|"reject"|"escalate" or per-signal "signal-validate"|"signal-dismiss"
  detail?: string;
}): Promise<{ ok: boolean; entry?: AuditEntry }> {
  try {
    const res = await fetch("/api/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as { ok: boolean; entry: AuditEntry };
  } catch {
    // offline: synthesize an entry so the audit log still works in the demo
    return {
      ok: true,
      entry: { ts: new Date().toISOString(), ...body, detail: body.detail ?? "" },
    };
  }
}

// Raw drift signals for the Clusters view. Tries the backend, falls back to the
// JSON bundled at build time so the graph renders even offline.
export async function fetchDriftSignals(): Promise<RawCompany[]> {
  try {
    const res = await fetch("/api/drift-signals");
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { companies: RawCompany[] };
    if (!Array.isArray(data.companies) || data.companies.length === 0) throw new Error("empty");
    return data.companies;
  } catch {
    return bundledDriftSignals as RawCompany[];
  }
}

export async function fetchAudit(): Promise<AuditEntry[]> {
  try {
    const res = await fetch("/api/audit");
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { auditLog: AuditEntry[] };
    return data.auditLog;
  } catch {
    return [];
  }
}
