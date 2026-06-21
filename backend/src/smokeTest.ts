// Endpoint smoke test. `npm run smoke` (backend must be running: npm run dev).
// Hits every REST endpoint and checks it responds 200 with the expected data shape — so a
// teammate can confirm "are all the endpoints alive and returning data?" in one command.
const BASE = `http://localhost:${process.env.PORT ?? 8787}`;

interface Probe {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  // a key that must be present, and (optionally) must be a non-empty array
  expectKey: string;
  expectNonEmpty?: boolean;
}

const PROBES: Probe[] = [
  { method: "GET", path: "/api/health", expectKey: "ok" },
  { method: "GET", path: "/api/portfolio/alerts", expectKey: "alerts", expectNonEmpty: true },
  { method: "GET", path: "/api/demo/alerts", expectKey: "alerts", expectNonEmpty: true },
  { method: "GET", path: "/api/drift-signals", expectKey: "companies", expectNonEmpty: true },
  { method: "GET", path: "/api/kyc-database", expectKey: "companies", expectNonEmpty: true },
  { method: "GET", path: "/api/sanctions-flags", expectKey: "flags" },
  { method: "GET", path: "/api/registry-drift", expectKey: "report", expectNonEmpty: true },
  { method: "GET", path: "/api/audit", expectKey: "auditLog" }, // empty until a decision is made — that's OK
  { method: "GET", path: "/api/cost", expectKey: "calls" },
  {
    method: "POST",
    path: "/api/decision",
    body: { clientId: "CUST-002", actor: "smoke-test", action: "approve" },
    expectKey: "ok",
  },
  {
    method: "POST",
    path: "/api/score",
    body: {
      baseline: {
        clientId: "SMOKE",
        legalName: "Smoke Test Co",
        jurisdiction: "US",
        legalForm: "x",
        onboardingDate: "2024-01-01",
        declaredBusinessDescription: "software",
        expectedMonthlyTxCount: 100,
        expectedMonthlyVolumeUSD: 1_000_000,
        expectedCounterpartyRegions: ["United States"],
        ubos: [],
        riskRating: "low",
        isSynthetic: true,
      },
      txs: [],
      signals: [],
    },
    expectKey: "composite",
  },
];

async function main() {
  console.log(`Endpoint smoke test → ${BASE}\n` + "─".repeat(66));
  let pass = 0;
  let fail = 0;
  for (const p of PROBES) {
    try {
      const res = await fetch(`${BASE}${p.path}`, {
        method: p.method,
        headers: p.body ? { "Content-Type": "application/json" } : undefined,
        body: p.body ? JSON.stringify(p.body) : undefined,
        signal: AbortSignal.timeout(60_000),
      });
      const data = (await res.json()) as Record<string, unknown>;
      const hasKey = p.expectKey in data;
      const val = data[p.expectKey];
      const nonEmptyOk = !p.expectNonEmpty || (Array.isArray(val) && val.length > 0);
      const ok = res.ok && hasKey && nonEmptyOk;
      const size = Array.isArray(val) ? `${val.length} items` : JSON.stringify(val).slice(0, 30);
      console.log(`  ${ok ? "✅" : "❌"} ${p.method.padEnd(4)} ${p.path.padEnd(26)} ${res.status}  ${p.expectKey}=${size}`);
      ok ? pass++ : fail++;
    } catch (e) {
      console.log(`  ❌ ${p.method.padEnd(4)} ${p.path.padEnd(26)} ERR  ${(e as Error).message}`);
      fail++;
    }
  }
  console.log("─".repeat(66));
  console.log(`RESULT: ${pass} passed, ${fail} failed → ${fail === 0 ? "✅ ALL ENDPOINTS LIVE" : "❌ SEE ABOVE (is the backend running? npm run dev)"}`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
