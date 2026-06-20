import type { Alert, AuditEntry, Cost } from "./types";
import { SEED_ALERTS, SEED_COST } from "./seed";
import type { RawCompany, SanctionFlag, RegistryDriftEntry } from "./clusters/graph";
import type { KycCompany } from "./kyc/KycView";
import bundledDriftSignals from "./data/kyc_drift_signals.json";
import bundledSanctionsFlags from "./data/kyc_sanctions_flags.json";
import bundledRegistryDrift from "./data/kyc_drift_report.json";
import bundledKycDatabase from "./data/kyc_database.json";

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

// Sanctions screening flags for the Clusters contagion overlay. Tries the backend, falls
// back to the JSON bundled at build time so the overlay renders even offline.
export async function fetchSanctionsFlags(): Promise<SanctionFlag[]> {
  try {
    const res = await fetch("/api/sanctions-flags");
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { flags: SanctionFlag[] };
    if (!Array.isArray(data.flags) || data.flags.length === 0) throw new Error("empty");
    return data.flags;
  } catch {
    return (bundledSanctionsFlags as { flags: SanctionFlag[] }).flags ?? [];
  }
}

// Corporate registry drift report for the Clusters view (drift-detected → red cluster).
// Tries the backend, falls back to the bundled JSON so the overlay renders offline.
export async function fetchRegistryDrift(): Promise<RegistryDriftEntry[]> {
  try {
    const res = await fetch("/api/registry-drift");
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { report: RegistryDriftEntry[] };
    if (!Array.isArray(data.report) || data.report.length === 0) throw new Error("empty");
    return data.report;
  } catch {
    return bundledRegistryDrift as RegistryDriftEntry[];
  }
}

// KYC onboarding database (docs/kyc_database.json) for the Onboarding view.
// Tries the backend, falls back to the bundled JSON so it renders offline.
export async function fetchKycDatabase(): Promise<KycCompany[]> {
  try {
    const res = await fetch("/api/kyc-database");
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { companies: KycCompany[] };
    if (!Array.isArray(data.companies) || data.companies.length === 0) throw new Error("empty");
    return data.companies;
  } catch {
    return bundledKycDatabase as unknown as KycCompany[];
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
