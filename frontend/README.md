# AMINA Frontend — Compliance Dashboard

React + Vite + TypeScript. Holds **no secrets** — it calls the backend via a dev proxy.

## Run
```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```
Then (in another terminal) start the backend so the dashboard goes live:
```bash
cd ../backend && npm run dev    # http://localhost:8787
```

- The Vite dev server proxies `/api/*` → `http://localhost:8787` (set `VITE_API_BASE` to
  override). No CORS config needed in dev.
- **Works with no backend too**: if `/api/demo/alerts` is unreachable it falls back to
  bundled seed data (`src/seed.ts`) and shows an "offline (seed data)" badge — so a demo
  never fails. When the backend is up it shows "● backend live".

## Screens
1. **Alert Queue** — clients sorted by risk, score meters, KYC-drift transition
   (`low → HIGH ⚠`), cost readout strip.
2. **Alert Detail** — declared baseline, contributing signals (magnitude/confidence bars,
   plain-English rationale, clickable source citations → evidence), pipeline trace, Stage 3
   deep analysis, and a sticky **Approve / Reject / Escalate** decision bar (stagegate —
   explicit action only, never auto-resolves).
3. **Audit Log** — immutable trail of analyst decisions.

API contract + types: `src/types.ts` (mirrors `../backend/src/types.ts`).
