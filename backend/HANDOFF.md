# 📬 Backend Handoff — for the frontend team / 프론트엔드 팀에게

> Backend is done. One call renders the dashboard. Full spec: `backend/API.md`.
> 백엔드 끝났습니다. 이거 하나만 호출하면 대시보드 다 그려져요.

## 1. Connect / 연결 (이미 돼 있을 것)
- Backend runs at `http://localhost:8787` — `cd backend && npm run dev`
- Frontend Vite proxy `/api` → `:8787` is already wired (`api.ts`). **No keys needed.**

## 2. The ONE endpoint you need / 메인 엔드포인트
```
GET /api/portfolio/alerts
```
Scores all 10 clients and returns them in one shot. **No per-case calls.**
```jsonc
{
  "source": "postgres",                 // data came from the DB
  "cost": { "mode": "stub", "calls": 0 },
  "alerts": [ /* one per client */ ]
}
```

## 3. One `alert` = one client (real output — Terraform Labs)
```jsonc
{
  "caseName": "Terraform Labs",
  "baseline": {                          // what the client declared at onboarding
    "clientId": "CUST-002",
    "legalName": "Terraform Labs",
    "jurisdiction": "Singapore",
    "riskRating": "medium"
  },
  "composite": {
    "compositeScore": 100,               // 0–100
    "riskFlag": "high",                  // color: low=green medium=amber high=red critical=black
    "contributingSignals": [             // ← render these as cards (the drift signals)
      { "category": "legal_regulatory_action", "magnitude": 62, "confidence": 0.62,
        "direction": "risk_increasing", "rationale": "why it fired",
        "suggestedAction": "recommended action", "isFraudTypology": false }
    ]
  },
  "stageTrace": [ "Hard gate clear...", "Embedding gate PASSED → Stage 2..." ],  // the "why" audit
  "deepAnalysis": { "summary": "...", "recommendedAction": "..." },  // HIGH cases only
  "jury": { "verdict": "risk_confirmed", "confidence": 0.6 }         // HIGH cases only
}
```

## 4. What to render / 뭘 그리나
| UI element | Field |
|---|---|
| Client list + risk color | `alert.composite.riskFlag` |
| Score | `alert.composite.compositeScore` (0–100) |
| **Drift-signal cards** | `alert.composite.contributingSignals[]` (category·magnitude·confidence·rationale) |
| Approve/Reject buttons | → `POST /api/decision` |
| "Why?" explanation | `alert.stageTrace[]` |
| Deep analysis / jury | `alert.deepAnalysis`, `alert.jury` (only when present, HIGH cases) |

## 5. Actions / 액션
```
POST /api/decision
body: { "clientId": "CUST-002", "actor": "analyst", "action": "approve" | "reject" | "escalate" }
→ { "ok": true, "entry": {...} }
```

## 6. ✅ Verified working / 작동 확인
- `cd backend && npm run health` → **18/18 pass** (files → DB → pipeline → API → frontend)
- 10 real clients: Boeing, Terraform, Revolut, Pfizer, Credit Suisse, Animoca, Bybit, JPEX, Alphabet, Amazon
- Data served from Postgres (`source: "postgres"`)

## 7. All endpoints / 전체 엔드포인트
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/portfolio/alerts` | GET | **main** — 10 clients scored from DB |
| `/api/demo/alerts` | GET | 3 scripted demo cases (LOW/HIGH/CRITICAL) |
| `/api/score` | POST | score an arbitrary client `{baseline, txs, signals}` |
| `/api/decision` | POST | human approve/reject/escalate |
| `/api/drift-signals` | GET | raw news graph (Clusters view) |
| `/api/kyc-database` | GET | raw KYC directory |
| `/api/sanctions-flags` | GET | sanctions screening flags |
| `/api/registry-drift` | GET | corporate registry drift |
| `/api/audit` | GET | audit log |
| `/api/cost` | GET | LLM cost readout |
| `/api/health` | GET | status `{ ok, llm, time }` |

Full request/response spec for every field: **`backend/API.md`**.
