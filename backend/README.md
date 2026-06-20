# AMINA Backend — Dynamic Risk Profiling

Holds **all secrets** and runs the tiered risk pipeline. The frontend never sees a key.

## Setup
```bash
cd backend
cp .env.example .env       # fill in keys (all optional — runs keyless with stubs)
npm install
npm run demo               # end-to-end on 3 built-in cases (works with NO keys)
npm run dev                # REST API on http://localhost:8787
npm run generate           # multi-model synthetic data (needs ≥1 provider key)
```

## Keys (all optional)
| Key | Enables |
|---|---|
| `ANTHROPIC_API_KEY` | live Stage 2 (Haiku) + Stage 3 (Sonnet). Without it, deterministic **stubs** run so everything still works. |
| `EVENTREGISTRY_API_KEY` | live news evidence (Layer 1). Without it, the signal's own text is used. |
| `VOYAGE_API_KEY` | real semantic embeddings. Without it, `simpleEmbed` (hashing) runs. |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` / `AZURE_OPENAI_*` | extra synthetic-data generators. |

## Pipeline (cheap → expensive)
```
hard gate (sanctions/PEP, exact)  →  CRITICAL short-circuit
rule diff (tx anomaly / dormancy / funding, no LLM)
embedding gate (baselineSim < 0.6 OR archetypeSim > 0.55)  →  discard if nothing notable
Stage 2 Haiku (classify flagged signals, RAG-grounded)
weighted scoring (confidence-adjusted, compliance-owned weights)
Stage 3 Sonnet (HIGH only → full escalation report)
human approve/reject (stagegate) + audit log
```

## REST endpoints
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness + whether LLM is live or stubbed |
| GET | `/api/demo/alerts` | run the 3 demo cases → alert queue for the dashboard |
| POST | `/api/score` | `{ baseline, txs, signals }` → full pipeline result + cost |
| POST | `/api/decision` | `{ clientId, actor, action, detail }` → records HITL decision |
| GET | `/api/audit` | the immutable audit log |
| GET | `/api/cost` | live cost readout (calls, $ total, $/1,000) |

See `../architecure plan/` for the design rationale, runbook, and benchmark research.
