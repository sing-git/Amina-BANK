import type { Alert, AuditEntry, Cost } from "./types";
import { SEED_ALERTS, SEED_COST } from "./seed";

// Calls the backend via the Vite proxy (/api → :8787). If the backend is
// unreachable, transparently falls back to bundled seed data so the demo
// always renders. `live` tells the UI which mode it's in.
export interface AlertsResponse {
  alerts: Alert[];
  cost: Cost;
  live: boolean;
}

export async function fetchAlerts(): Promise<AlertsResponse> {
  try {
    const res = await fetch("/api/demo/alerts");
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { alerts: Alert[]; cost: Cost };
    return { ...data, live: true };
  } catch {
    return { alerts: SEED_ALERTS, cost: SEED_COST, live: false };
  }
}

export async function postDecision(body: {
  clientId: string;
  actor: string;
  action: "approve" | "reject" | "escalate";
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
