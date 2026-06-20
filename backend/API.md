# AMINA Backend API — the frontend contract

Base URL: `http://localhost:8787` (set `PORT` to change). All responses JSON.
Frontend never needs keys — it only calls these endpoints.

## The main one — the alert queue

### `GET /api/portfolio/alerts`
The 10 real clients scored end-to-end from Postgres (news + transactions + sanctions
contagion + registry drift). **This is what the dashboard renders.**

```jsonc
{
  "source": "postgres",            // or "json-files" if DB is down
  "cost": { "mode": "stub", "calls": 0, "totalUSD": 0, ... },
  "alerts": [ Alert, Alert, ... ]  // one per client
}
```

### `GET /api/demo/alerts`
Same `Alert[]` shape, but the 3 scripted demo cases (LOW / HIGH / CRITICAL). Use for a
guaranteed-clean demo. Response: `{ alerts: Alert[], cost }`.

## The `Alert` object (the core shape both endpoints return)

```jsonc
{
  "caseName": "The Boeing Company",
  "baseline": {                       // Layer-2 onboarding KYC (what the client declared)
    "clientId": "CUST-001",
    "legalName": "The Boeing Company",
    "jurisdiction": "US",
    "legalForm": "...",
    "declaredBusinessDescription": "...",
    "expectedMonthlyVolumeUSD": 5000000000,
    "expectedCounterpartyRegions": ["United States","European Union",...],
    "ubos": [{ "name": "...", "ownershipPct": 0, "isPEP": false }],
    "riskRating": "medium",
    "isSynthetic": true
  },
  "composite": {                      // the score
    "clientId": "CUST-001",
    "compositeScore": 100,            // 0–100
    "riskFlag": "high",              // "low" | "medium" | "high" | "critical"
    "contributingSignals": [ SignalScore, ... ],   // ← drift dimensions that fired (render these)
    "neutralSignals": [ SignalScore, ... ],        // threshold-refresh updates, not risk
    "hardGateTriggered": false,
    "hardGateReason": "Sanctions/PEP match: ..."   // present only if a hard gate hit
  },
  "stageTrace": [ "Hard gate clear...", "Numeric → ruleDiff: ...", ... ],  // human-readable audit
  "deepAnalysis": {                   // present only on HIGH cases (Stage 3)
    "summary": "...", "fullReasoningChain": "...",
    "recommendedAction": "...", "allSourcesUsed": ["..."]
  },
  "jury": {                           // present only on HIGH cases (adversarial jury)
    "verdict": "risk_confirmed", "confidence": 0.6,
    "prosecutionArgument": "...", "defenseArgument": "...",
    "judgeReasoning": "...", "recommendedAction": "..."
  },
  "sanctionsReview": {                // present only if a name is in the 85–98 review band
    "candidates": [{ "name": "...", "matchedEntity": "...", "score": 90, "source": "..." }],
    "note": "..."
  },
  "evidenceBySignal": { "<signalId>": [{ "text": "...", "sourceUrl": "..." }] }
}
```

### `SignalScore` (one fired drift dimension — render with approve/reject buttons)
```jsonc
{
  "signalId": "9376",
  "category": "business_model_pivot",       // the drift dimension
  "method": "rule_diff" | "embedding" | "llm_classification",
  "magnitude": 81,                          // 0–100 (how severe)
  "direction": "risk_increasing" | "neutral_update" | "positive" | "unknown",
  "rationale": "…why this fired…",
  "suggestedAction": "request enhanced KYC documents",
  "sourceCitations": ["https://..."],
  "confidence": 0.62,                       // 0–1
  "isFraudTypology": true                   // → show the [FRAUD/AML] badge
}
```

## Actions (human-in-the-loop)

### `POST /api/decision`
Analyst approves/rejects a case or a single signal.
```jsonc
// request body
{ "clientId": "CUST-001", "actor": "analyst@bank", "action": "approve" | "reject" | "escalate", "detail": "optional note" }
// response
{ "ok": true, "entry": { "ts": "...", "clientId": "...", "actor": "...", "action": "...", "detail": "..." } }
```

### `POST /api/score`
Score an arbitrary client on demand (not from the DB).
Body: `{ baseline: ClientBaseline, txs: TransactionRecord[], signals: RawSignal[] }` →
returns the same fields as one `Alert` (composite, stageTrace, deepAnalysis?, jury?) + `cost`.

## Read-only feeds (for the Clusters view + panels)

| Endpoint | Returns | For |
|---|---|---|
| `GET /api/health` | `{ ok, llm: "live"\|"stub", time }` | status badge |
| `GET /api/drift-signals` | `{ companies: [...] }` (Giulio's raw news graph) | Clusters hub-and-spoke |
| `GET /api/kyc-database` | `{ companies: [...] }` (raw KYC db) | client directory |
| `GET /api/sanctions-flags` | `{ flags: [...] }` (Kiara's screening) | contagion overlay |
| `GET /api/registry-drift` | `{ report: [...] }` (Alice's registry) | drift highlight |
| `GET /api/audit` | `{ auditLog: [...] }` | audit log panel |
| `GET /api/cost` | `{ mode, calls, totalUSD, stage2USD, stage3USD, costPer1000USD }` | cost readout |

## Notes for the frontend
- Render **`composite.contributingSignals`** as the per-dimension cards (each with approve/reject).
- Show `deepAnalysis` / `jury` only when present (HIGH cases).
- `stageTrace` is the "why" audit list.
- `riskFlag` drives the color: low=green, medium=amber, high=red, critical=black.
- Everything is one fetch to `/api/portfolio/alerts` — no per-case round-trips needed.
