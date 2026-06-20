# AMINA — Walkthrough (architecture order) / 아키텍처 순서 설명

> Read top to bottom = the path one signal takes through the system.
> 위에서 아래로 = 신호 하나가 시스템을 통과하는 경로. 각 단계: 무엇 / 파일 / 왜.

All backend code is under **`backend/src/`**. `.ts` = a **TypeScript** file (JavaScript + types).
모든 백엔드 코드는 `backend/src/` 아래. `.ts` = 타입스크립트 파일.

---

## Step 0 — Collect public signals / 공개 신호 수집 (Python, `scrapers/`)
**EN.** Team Python scrapers gather Layer-1 data. Giulio: RSS news → company NER → gemma3:4b
screens for drift → `kyc_drift_signals.json`. Alice: corporate registry. Kiara: sanctions.
**KR.** 팀의 Python 스크래퍼가 Layer-1(공개) 데이터를 모음. Giulio=뉴스, Alice=등기, Kiara=제재.
- **Files:** `scrapers/news-feed/`, `scrapers/corporate/`, `scrapers/sanctions/`
- **Why:** the signals that matter appear in public first (news/registry/sanctions).

## Step 1 — Bridge into our schema / 공통 형식으로 변환 (`backend/src/ingest/`)
**EN.** Adapters convert each scraper's output into our `RawSignal` / `ClientBaseline` types.
**KR.** 어댑터가 각 스크래퍼 출력을 우리 공통 타입으로 변환 (이게 통합 지점).
- **Files:** `ingest/kycAdapter.ts` (KYC db → baseline), `ingest/newsAdapter.ts` (drift signals →
  RawSignal), `ingest/sanctionsAdapter.ts` (sanctions hits)
- **Why:** one schema = the pipeline doesn't care which scraper produced a signal.

## Step 2 — Hard gate / 하드게이트 (`pipeline/hardGate.ts`)
**EN.** Sanctions/PEP exact+fuzzy name match. Score ≥98 → instant CRITICAL; 85–98 → human review
queue (avoids same-name-different-company false positives). Runs FIRST, short-circuits everything.
**KR.** 제재/PEP 이름 매칭. 98↑ 즉시 CRITICAL, 85~98 사람 검토 큐. 제일 먼저, 걸리면 즉시 차단.
- **Why:** a sanctioned client is an instant block — no need to run anything else.

## Step 3 — Routing / 라우팅 (`pipeline/classifyRawSignal.ts`)
**EN.** A hardcoded table sends each signal to the right method by its `sourceType`:
numeric (transaction/funding) → rules · narrative (news/registry/domain) → embeddings+LLM.
**KR.** 신호의 `sourceType` 도장으로 방법 결정 (고정 표, AI 아님).
- **Why:** numbers need math, text needs meaning, names need exact match — different tools.

## Step 4 — Stage 1: cheap filters / 싼 필터 (free, no LLM)
**EN.** (a) **Rules** (`pipeline/ruleDiff.ts`): structuring / money-mule / dormancy / funding —
pure arithmetic on transactions. (b) **Embedding gate** (`pipeline/embeddings.ts`): turn text into
vectors, compare to the client's declared business + 11 risk archetypes; only "notable" text passes.
**KR.** (a) 규칙(거래 산수), (b) 임베딩 게이트(텍스트 의미 비교) — 둘 다 공짜. 통과한 것만 다음 단계로.
- **Files:** `ruleDiff.ts`, `embeddings.ts` (+ `config/riskPolicy.json` archetypes)
- **Why:** drop most signals for free → only the suspicious few reach paid models (cost efficiency).

## Step 5 — Stage 2: LLM classify / LLM 분류 (`pipeline/stage2Classify.ts`)
**EN.** For signals that passed Stage 1, an LLM (local gemma OR Claude Haiku OR stub) reads the
evidence and outputs direction (risk/neutral/positive), magnitude, confidence, rationale, action.
**KR.** Stage 1 통과 신호만 LLM이 읽고 방향/심각도/신뢰도/이유/권고 출력.
- **Why:** only the LLM can judge *good vs bad* (embeddings only say "related").

## Step 6 — Scoring / 점수 계산 (`pipeline/scoringEngine.ts` + `config/riskPolicy.json`)
**EN.** Combine all signal scores into one composite (0–100) → riskFlag. Formula:
`Σ(magnitude × weight/MAX_WEIGHT × confidence)`. Weights live in the compliance-owned policy file.
**KR.** 모든 신호 점수를 하나의 0–100 점수로 합산 → 플래그. 가중치는 정책 파일에.
- **Files:** `scoringEngine.ts` (formula), `policy.ts` (loads policy), `config/riskPolicy.json`
  (weights/thresholds), `recommendations.ts` (per-category action + fraud set)
- **Why:** one number a compliance officer can act on; weights = policy, swappable per bank.

## Step 7 — Stage 3: deep analysis + Jury / 정밀 분석 (HIGH only)
**EN.** HIGH cases get a full report (`pipeline/stage3DeepAnalysis.ts`, with a transaction
time-series summary), plus an **adversarial Jury** (`pipeline/jury.ts`): prosecutor argues risk,
defense argues benign, judge decides.
**KR.** 고위험만 정밀 보고서 + 배심(검사 vs 변호 → 판사 판정).
- **Why:** the expensive, careful analysis only for the few that need it.

## Step 8 — Serve / 제공 (`backend/src/server.ts`)
**EN.** REST API. `/api/portfolio/alerts` reads baselines+signals from Postgres (or JSON fallback),
runs the pipeline, returns scored alerts. `/api/decision`, `/api/audit`, `/api/cost`.
**KR.** REST API. 포트폴리오 알림을 Postgres에서 읽어 파이프라인 돌려 반환.
- **Files:** `server.ts`, `db.ts` (Postgres), `dbIngest.ts`/`scheduler.ts` (24h 적재)

## Step 9 — Dashboard / 대시보드 (`frontend/`)
**EN.** Compliance UI: alert queue, detail (signals, rationale, citations), per-signal
approve/reject/escalate/note, audit log, Demo/Portfolio toggle.
**KR.** 컴플라이언스 UI: 알림 큐, 상세, 시그널별 승인/거부/에스컬레이션/메모, 감사로그.
- **Files:** `frontend/src/App.tsx`, `ui.tsx`, `api.ts`, `seed.ts`, `styles.css`

---

## The two formulas, explained / 두 공식 설명

### Structuring rule / 분할거래 규칙 (`ruleDiff.ts`)
```
band = transactions in [$8,000, $10,000)  within 30 days
flag if count(band) ≥ 3
```
**Why $10,000?** It's the US **Currency Transaction Report (CTR)** reporting threshold. Criminals
split money into amounts *just under* it to avoid the report — that's "structuring/smurfing".
**Why ≥3?** A chosen sensitivity (1–2 could be coincidence; 3+ looks like a pattern). It's a
**tunable** in `riskPolicy.transactionRules`, not a law. **KR.** $10,000 = 미국 CTR 신고 기준선.
범죄자가 그 바로 아래로 쪼개면 분할거래. 3건 = 우리가 정한 민감도(조정 가능).

### Composite score / 종합 점수 (`scoringEngine.ts`)
```
score = Σ_risk ( magnitude × (weight / MAX_WEIGHT) × confidence )
      − Σ_positive ( ... × softeningFactor )
flag = score<30 low · <60 medium · else high
```
**weight** = how important that drift type is (policy). **MAX_WEIGHT** = the biggest weight (20),
so the most-important factor at full magnitude/confidence ≈ contributes its weight. **confidence**
= how sure we are. **FATF/Basel** = international AML standards (Financial Action Task Force / Basel
Committee) — we used their risk-factor *idea* (beneficial-ownership & PEP = high risk) to set the
weight tiers. **KR.** 가중치=중요도, confidence=확신, FATF/Basel=국제 AML 기준(가중치 tier의 근거).

---

## Honest status / 솔직한 상태 (fact-check)

| Claim in docs | Reality |
|---|---|
| Research repos/papers (kyc-analyst, arXiv cascade, SAML-D) | ✅ **real** (found via web search). They are **inspiration**, not literal code we copied. |
| "weights calibrated against README's 10 rows" | ⚠️ **partial** — weights are FATF-*informed* + hand-set; we have a 5-case eval, not all 10 rows run. |
| funding (Crunchbase/PitchBook) | ❌ **not wired** — category + rule exist; no live connector. |
| Stage 2/3 real reasoning text | ⚠️ only with a key or Ollama; otherwise **stub** (placeholder text). |
| Kiara `kyc_check.py` sanctions output | ⚠️ her code pulled in; output not yet wired to our adapter. |

**Don't over-claim to judges.** Say "inspired by", "weights are FATF-informed and tunable",
"funding is architecturally supported, not wired". 정직하게 말하기.
