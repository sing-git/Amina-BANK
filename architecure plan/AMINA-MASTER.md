# AMINA — Dynamic Risk Profiling: Master Spec / 마스터 명세

> Single source of truth. Merges: technical architecture, build runbook, research
> benchmarks, system overview, jury feedback. **English + 한국어.**
> 단일 통합 문서. 기술 아키텍처·실행 순서·벤치마크·시스템 개요·평가자 피드백을 합침.

**Branch:** `integration` (= our TS + team Python scrapers + adapters).
**Demo company strategy:** a few cases deep, not all — but scalable by config (jury guidance).

---

## 0. What we build / 무엇을 만드나

**EN.** A continuous **KYC-drift detector with tiered reasoning**. We watch *public* real-time
signals (news, sanctions, registry/ownership, funding, domain) and compare them against each
client's *internal* onboarding KYC baseline. When real-world activity quietly diverges from what
the client declared at onboarding, we flag the drift. Cost-awareness is structural: cheap, keyless
filters first; an LLM only on flagged cases; the heaviest model only on HIGH-risk cases. A
compliance officer approves/rejects every decision; everything is logged for audit.

**KR.** 고객이 온보딩 때 약속한 모습과 실제 행동이 **슬금슬금 달라지는 것(KYC 드리프트)**을 실시간
공개신호(뉴스·제재·등기·펀딩·도메인) + 내부 KYC 기준선으로 잡아내는 시스템. 싼 필터로 먼저 거르고,
비싼 LLM은 의심 케이스에만, 제일 비싼 모델은 고위험에만 — 비용 효율이 구조에 박혀 있음. 모든 결정은
사람이 승인/거부하고, 전부 감사 로그에 남김.

---

## 1. End-to-end data flow / 전체 데이터 흐름

```
┌──────────── LAYER 1: public signals (Python, scrapers/) ────────────┐
│  news-feed (Giulio)        corporate (Alice)       sanctions (Kiara) │
│  RSS→NER→gemma3:4b 필터     등기 비교                OFAC/UN fuzzy      │
│  → kyc_drift_signals.json   → 관할/법인형태 변경      → 이름 매칭        │
└───────┬──────────────────────────┬──────────────────────┬────────────┘
        ▼ (24h → Postgres)          ▼                      ▼
   newsAdapter ──┐   kycAdapter ──┐    sanctionsAdapter ──┐ (TS, backend/src/ingest/)
        RawSignal[] │  ClientBaseline │   {matched,entity}  │
                    ▼                ▼                      ▼
┌──────────── LAYER 2 + scoring pipeline (TS, backend/src/pipeline/) ──┐
│  classifyRawSignal() → numeric | narrative | identity                │
│   numeric  → ruleDiff (structuring/mule/dormancy)                    │
│   narrative→ embedding gate → Stage 2 (Haiku)                        │
│   identity → hardGate (sanctions exact/fuzzy) → CRITICAL             │
│        → SignalScore[] → filter weak → computeCompositeScore         │
│        → riskFlag; HIGH → Stage 3 (Sonnet) report                    │
└───────┬──────────────────────────────────────────────────────────────┘
        ▼ REST API (server.ts): /api/demo/alerts · /api/portfolio/alerts · /api/decision · /api/audit · /api/cost
        ▼ Dashboard (frontend/): queue · detail · per-signal HITL · audit · cost · Demo/Portfolio toggle
```

---

## 2. Two layers / 두 계층

**Layer 1 — Public real-time intelligence (non-sensitive).**
News & adverse media, sanctions/watchlists, corporate registry & ownership, funding, domain/website.
공개·비민감 신호. 누구나 볼 수 있는 밖의 정보.

**Layer 2 — Simulated internal bank intelligence (sensitive).**
The synthetic KYC baseline (`ClientBaseline`) + synthetic transaction history. Real bank data is
private, so we generate it and **label everything `isSynthetic`**. Profiles should be *anchored to a
real company's public footprint* (e.g. Ostium's real funding) while the transaction numbers are
invented. 진짜 은행 데이터는 비밀이라 합성으로 만들되, 실제 회사 공개정보에 앵커링하고 전부 합성 라벨.

**Combine, don't silo / 따로 계산 말고 합산:** every signal (news *or* transaction) becomes a
`SignalScore` and they all feed ONE `computeCompositeScore`. The "news + transaction together"
magic = both contribute to the same weighted sum.

---

## 3. Three stages + cost tiering / 3단계 비용 계층

| Stage | Analogy | Model | Cost | Runs on |
|---|---|---|---|---|
| Hard gate | 수배자 명단 | exact/fuzzy name match | free | everyone, first |
| Stage 1 | 체온계 | rules + embeddings (+ Giulio gemma3:4b) | free/local | everyone |
| Stage 2 | 피검사 | Claude Haiku 4.5 | cheap paid | flagged only |
| Stage 3 | MRI | Claude Sonnet 4.6 | expensive paid | HIGH only |

**EN.** Don't run the expensive model on everyone. Cheap filters drop most; only ~the risky few
reach paid models. This is the challenge's explicitly-judged **cost efficiency** (20%).
**KR.** 비싼 모델을 전원에게 쓰면 돈 폭탄. 싼 필터가 대부분 거르고 위험한 소수만 유료 모델로.

Cost tier order (cheapest first):
```
1. Giulio gemma3:4b (local, free)  뉴스 거름 + drift 차원 태깅
2. embedding gate (free)           의미 드리프트 1차 필터
3. ruleDiff (free arithmetic)      거래 fraud 전형
4. Stage 2 Haiku (cheap paid)      살아남은 신호만 점수화
5. Stage 3 Sonnet (expensive)      HIGH만 정밀 보고서
```

---

## 4. Signal routing — `classifyRawSignal()` / 시그널 라우팅

**EN.** Routing and drift-detection are different jobs. Routing does NOT use similarity — we know the
type from the `sourceType` stamped at ingestion. It's a hardcoded table lookup, deterministic, no AI.

**KR.** "타입 구분"과 "드리프트 감지"는 다른 작업. 타입 구분에 유사도 안 씀 — 수집할 때 찍힌
`sourceType` 도장을 읽을 뿐. 고정 표 조회(결정론적, AI 아님).

```ts
const ROUTE_BY_SOURCE = {
  transaction: "numeric",   funding_db: "numeric",       // → ruleDiff (arithmetic)
  news: "narrative", registry: "narrative", domain: "narrative", // → embedding → Stage 2
};                                                         // identity → hardGate (names, exact/fuzzy)
```

Each type uses a DIFFERENT method — that's *why* we route first:
| Type | Method | Why not embeddings |
|---|---|---|
| numeric | rules (% deviation) | numbers → subtraction is exact, free, explainable |
| identity (names) | exact/fuzzy match | "Ivan Petrov" ≈ "Petroff" → similarity = false positives |
| narrative (text) | embeddings + LLM | meaning must be compared — the only place similarity belongs |

**Baseline = onboarding KYC profile** (`ClientBaseline`): expected volume/count, counterparty
regions, declared business (embedding anchor), risk rating, UBOs.

**Embedding drift, two angles:** `baselineSim` (low = drifted from declared self) and
`archetypeSims[]` (high = resembles a known risk pattern). Gate: `baselineSim < 0.6 OR
max(archetypeSims) > 0.55` → Stage 2.

---

## 5. Drift taxonomy (expanded to ~20) / 드리프트 분류 (약 20개로 확장)

**EN.** Giulio's screener emits 7 dimensions; our `SignalCategory` now has **19 implemented**
categories (weights in `riskPolicy.json` + recommended actions in `recommendations.ts`), grounded in
FATF red flags + the README use-case table + the available sources. Items marked **(new)** are the
extensions added to the type; numeric rules / archetypes for some still TODO.

**KR.** Giulio는 7개, 우리 코드는 이제 **19개 구현됨** (정책 가중치 + 권고 포함). **(new)** = 타입에
추가된 확장분 (일부는 규칙/아키타입 구현 TODO).

| # | Drift dimension | Source | Route | 비고 |
|---|---|---|---|---|
| 1 | business_model_pivot | news / website | narrative | SaaS→crypto 등 |
| 2 | negative_news / adverse_media | news | narrative | 부정 보도 |
| 3 | negative_sentiment **(new)** | news sentiment | narrative | adverse media 세분화 |
| 4 | legal_regulatory_action **(new)** | news | narrative | 소송·벌금·조사 |
| 5 | entity_name_change | registry (GLEIF/ZEFIX) | narrative | 법인명 변경 |
| 6 | jurisdiction_change | registry | narrative | 관할 이전 |
| 7 | legal_form_change **(new)** | registry | narrative | GmbH→offshore IBC |
| 8 | ownership_change | registry / PSC | narrative→identity | 새 대주주 |
| 9 | nominee_ownership **(new)** | ICIJ Offshore Leaks | narrative | 명의주주/페이퍼 |
| 10 | key_personnel_change **(new)** | news / registry | narrative | CEO/CFO 교체 |
| 11 | pep_exposure **(new)** | OpenSanctions PEP | identity | 임원 PEP |
| 12 | sanctions_match | OFAC/UN/EU | identity | 하드게이트 |
| 13 | domain_change | WHOIS | narrative | 도메인 변경 |
| 14 | website_content_change **(new)** | Wayback / Firecrawl | narrative | 사이트 내용 변경 |
| 15 | funding_scale_change | Crunchbase | numeric | 펀딩 급변 |
| 16 | rapid_geographic_expansion **(new)** | news / funding | narrative | 급속 확장 |
| 17 | cross_border_anomaly | internal tx | numeric | money mule |
| 18 | structuring_pattern | internal tx | numeric | smurfing |
| 19 | dormancy_break | internal tx | numeric | 휴면 후 폭증 |
| 20 | unexplained_volume_surge **(new)** | internal tx / news | numeric | 설명불가 급증 |

Implementation note: adding a category = add it to `SignalCategory`, give it a weight in
`riskPolicy.json`, and a default action in `recommendations.ts`. Numeric ones need a rule; narrative
ones just need an archetype + LLM.

### 5.1 How the taxonomy was built / 어떻게 만들었나

**EN.** The categories are not invented arbitrarily — each is derived from three grounded sources,
so we can defend every one when a judge asks "why this dimension?":
1. **README's 10 use-case rows** — the challenge's own reference table (e.g. "ownership change →
   KYC drift", "jurisdiction move → structural risk change").
2. **FATF red-flag typologies** — internationally recognized AML risk factors. This is also what
   sets the **weight tiers**: FATF treats beneficial-ownership and PEP exposure as high-risk, so
   `nominee_ownership` (15) and `pep_exposure` (16) carry high weight; a cosmetic `domain_change`
   (4) is low.
3. **Available data sources** — every category must be detectable from a real source (news,
   registry, ICIJ, OpenSanctions, internal transactions). A dimension with no source is dropped.

Each category is therefore a tuple: `(drift dimension, source, detection method, weight)`.
Implemented across: `SignalCategory` (type) + `riskPolicy.signalWeights` (weight) +
`recommendations.RECOMMENDED_ACTIONS` (action) + a `riskArchetype` (so the embedding gate can match
narrative ones) + a `ruleDiff` formula (for numeric ones).

**KR.** 카테고리는 임의로 만든 게 아니라 **3개 근거**에서 도출 — 심사에서 "왜 이 차원?"에 답할 수
있도록: ① README 10개 use-case 표, ② FATF 적색신호(가중치 tier도 여기서 — 실소유주·PEP는 고위험이라
가중치 높음, 단순 도메인 변경은 낮음), ③ 가용 데이터 소스(검출 가능한 것만). 각 카테고리 = `(차원,
소스, 검출방법, 가중치)` 튜플.

### 5.2 What weight means / 가중치의 의미

**EN.** Weight is **relative importance**, NOT "good/bad". It scales how much a fired signal pushes
the composite score:
```
contribution = magnitude × (weight / MAX_WEIGHT) × confidence
```
`MAX_WEIGHT` = the largest weight (20, `business_model_pivot`). So a category at weight 20 contributes
fully at its magnitude; weight 10 contributes half as much for the same magnitude/confidence. Higher
weight = "compliance policy considers this drift type more dangerous", set per the FATF tiers above.
Weights live in `riskPolicy.json`, owned by compliance — the AI executes the policy, it doesn't set
it. **KR.** 가중치 = 상대적 중요도(좋다/나쁘다 아님). 높을수록 그 신호가 점수를 더 많이 올림. FATF
tier 기준. 정책 파일 소유는 컴플라이언스 — AI는 정책을 실행만 함.

---

## 6. Core data types / 핵심 데이터 타입

```ts
interface ClientBaseline {            // Layer 2 synthetic
  clientId; legalName; jurisdiction; legalForm; onboardingDate;
  declaredBusinessDescription;        // embedding anchor
  expectedMonthlyTxCount; expectedMonthlyVolumeUSD; expectedCounterpartyRegions;
  ubos: { name; ownershipPct; isPEP }[]; riskRating: "low"|"medium"|"high";
  isSynthetic: true; generatedBy?: "claude"|"gemini"|"openai"|"azure"|"manual";
}
interface RawSignal {
  signalId; clientId; category: SignalCategory; detectedAt;
  sourceType: "news"|"registry"|"domain"|"transaction"|"funding_db";
  sourceUrl?; rawText?; newsQuery?;       // narrative / live news
  rawNumeric?; rawNumericContext?;        // numeric
}
interface SignalScore {
  signalId; category; method: "rule_diff"|"embedding"|"llm_classification";
  magnitude;            // 0-100
  direction: "risk_increasing"|"neutral_update"|"positive"|"unknown";
  rationale; suggestedAction; sourceCitations: string[]; confidence; // 0-1
  isFraudTypology?;
}
interface CompositeScoreResult {
  clientId; compositeScore; riskFlag: "low"|"medium"|"high"|"critical";
  contributingSignals; neutralSignals; hardGateTriggered; hardGateReason?;
}
interface DeepAnalysisReport { clientId; summary; fullReasoningChain; allSourcesUsed; recommendedAction; generatedAt; }
```

---

## 7. Module breakdown / 모듈 구성

```
backend/src/
  types.ts                 -- all interfaces
  config/riskPolicy.json   -- SINGLE source of every tunable (weights/thresholds/gate/archetypes/filter)
  pipeline/
    policy.ts              -- loads riskPolicy.json (+ MAX_WEIGHT, flagForScore)
    classifyRawSignal.ts   -- numeric|narrative routing table
    ruleDiff.ts            -- structuring / cross-border-mule / dormancy / funding (no LLM)
    hardGate.ts            -- sanctions/PEP (real hits → demo stub)
    embeddings.ts          -- simpleEmbed (free) / voyageEmbed; cosineSimilarity; archetypes
    stage2Classify.ts      -- Haiku classification (+ keyless stub)
    stage3DeepAnalysis.ts  -- Sonnet report (+ keyless stub)
    scoringEngine.ts       -- confidence-adjusted weighted composite
    recommendations.ts     -- README actions + fraud typology set
    mcpNews.ts             -- EventRegistry live news (fetchEvidenceViaMCP)
    llm.ts                 -- Anthropic wrapper + cost log + JSON extract
    pipeline.ts            -- orchestrator
  ingest/
    kycAdapter.ts          -- data/kyc_database.json → ClientBaseline[]
    newsAdapter.ts         -- kyc_drift_signals.json → RawSignal[]
    sanctionsAdapter.ts    -- data/sanctions_hits.json → hard-gate lookup
  db.ts, dbInit.ts         -- Postgres
  server.ts                -- REST API
  demo.ts, liveDemo.ts, demoIngest.ts, eval/runEval.ts, data/generators/
```

---

## 8. Fraud / AML typology formulas / fraud 공식 (`ruleDiff.ts`)

Tunables in `riskPolicy.transactionRules`. Deterministic, reproducible by hand (auditor-friendly).

**Structuring / smurfing → `structuring_pattern`**
```
band = { tx : 0.8×CTR_THRESHOLD ≤ amount < CTR_THRESHOLD }  within 30d   # $8k–$9,999
flag if |band| ≥ 3 ;  magnitude = clamp(|band| × 20)
```
**Cross-border / money mule → `cross_border_anomaly`**
```
deviation   = (inVol+outVol − expectedMonthlyVolume) / expectedMonthlyVolume
passThrough = outVol / inVol ;  crossOut = outbound to region ∉ expected ;  crossShare = ΣcrossOut/outVol
flag if crossOut≠∅ AND (deviation>0.5 OR passThrough≥0.8)
magnitude = clamp(min(deviation,2)×30 + crossShare×40 + (passThrough≥0.8?30:0))
```
**Dormancy break → `dormancy_break`**
```
maxGap = largest gap (days) ; burst = Σ amounts in 30d after gap
flag if maxGap ≥ 180 AND burst>0 ;  magnitude = clamp(40 + maxGap/10)
```
**Funding scale → `funding_scale_change`** (default neutral; Stage 2 may re-judge positive/risk)
```
multiple = current/previous ; magnitude = clamp(log10(max(multiple,1.01))×50)
```

---

## 9. Scoring, weights & policy / 스코어링·가중치·정책

**EN.** All tunables live in `config/riskPolicy.json` — the compliance-owned policy. Onboarding a
different institution = swap this file, **no code change**. This is the jury's "scalable via
parameters" + "exact logic" requirement.

**KR.** 모든 튜닝값이 `riskPolicy.json` 한 파일에. 다른 기관 = 파일만 교체(코드 0). 평가자의
"파라미터만 바꾸면 + 정확한 로직" 요구 충족.

```
compositeScore = Σ_risk ( magnitude × (weight/MAX_WEIGHT) × confidence )
               − Σ_positive ( magnitude × (weight/MAX_WEIGHT) × confidence × softeningFactor )
riskFlag = score < 30 ? low : score < 60 ? medium : high      (hard gate → critical)
```
- Weights are **relative importance** (scaled by /MAX_WEIGHT) so a single severe high-confidence
  signal can reach HIGH — calibrated against README's 10-row reference table.
- **Weak-signal filter**: drop a signal only if `confidence < 0.4 AND magnitude < 50` (jury: cut
  low-value signals); logged for audit.
- **Weight provenance**: aligned to FATF/Basel risk-factor tiers + calibrated on README scenarios.
  Future: regression-fit on real labeled outcomes.

---

## 10. Sanctions & homonym disambiguation / 제재·동명이인

**EN.** Pure exact match misses variants ("Acme Ltd" vs "Acme Limited"); pure fuzzy auto-block
creates false positives (same name, different company). Recommended two-tier:
```
fuzzy candidate (≥85) → check secondary identifiers (jurisdiction / LEI / address / entity_type)
   score ≥98 AND identifiers match  → auto-CRITICAL
   85–98 OR identifiers unknown      → human review queue (HITL)
```
**KR.** exact만 쓰면 변형 놓치고, fuzzy 자동차단은 동명이인 오탐. → fuzzy로 후보 찾고 **2차 식별자
(관할·LEI·주소)로 대조**, 불일치/애매하면 자동 차단 대신 **사람 검토 큐**로. 임계값은 정책 파일에.
*Status:* **two-tier implemented** — auto-CRITICAL at score ≥98, human review queue at 85–98
(policy-driven `riskPolicy.sanctions`), with jurisdiction identifier check + a "review pending"
banner in the dashboard. Kiara's matcher feeds it.

---

## 11. Guardrails / 가드레일 (challenge requires)

- **Data security:** Layer 1/Layer 2 separation; secrets only in `backend/.env` (git-ignored);
  frontend gets zero keys; audit log of every decision.
- **Model guardrails:** human-in-the-loop (per-signal validate/dismiss/note + per-case
  approve/reject); explainable rationale; confidence scores; source citations; "advisory only"
  badge; keyless deterministic stubs prevent hallucinated demos.
- **Decision governance:** stagegate — a case advances only on explicit analyst action, never on
  silence; immutable audit trail.

---

## 12. Challenge output coverage / 챌린지 5대 출력 충족

| Required | Status | Produced by |
|---|---|---|
| early risk alerts | ✅ | KYC-drift detection → alert queue |
| fraud warnings | ✅ | `ruleDiff` AML typologies, `[FRAUD/AML]` badge |
| risk scoring | ✅ | compositeScore 0–100 + riskFlag |
| compliance insights | ✅ | rationale + citations + Stage 3 reasoning + audit |
| actionable recommendations | ✅ | per-signal `suggestedAction` + Stage 3 `recommendedAction` |

Judging weights: AI quality 25 · cost 20 · UX/explainability 20 · compliance 20 · engineering 15.

---

## 13. Team integration / 팀 통합 (the `RawSignal` contract)

**EN.** Each scraper outputs our common schema; the pipeline routes it. Merge by *output format*,
not by tangling code. **KR.** 각 스크래퍼가 공통 형식으로만 내보내면 파이프라인이 자동 처리.

| Member | Output | → |
|---|---|---|
| Kiara (sanctions) | matches | `{matched, matchedEntity}` → hardGate |
| Giulio (news) | kyc_drift_signals.json (7 dims) | `RawSignal{sourceType:"news"}` |
| Alice (registry) | jurisdiction/form change | `RawSignal{sourceType:"registry"}` |
| You (tx/funding) | numeric | `RawSignal{sourceType:"transaction"/"funding_db"}` |

Folders: `scrapers/` (Python: news-feed, corporate, sanctions) · `data/` (kyc_database.json,
sanctions_hits.json) · `backend/` (TS pipeline+API) · `frontend/` (dashboard).
**Giulio's gemma3:4b screener ≠ our Stage 2** — it's a cheaper *pre-filter* that selects + tags;
severity/scoring/recommendations are ours (downstream). Complementary cost tiers, not duplicate.

---

## 14. Research & benchmarks / 리서치·벤치마크

| Repo / dataset | Borrow |
|---|---|
| [vyayasan/kyc-analyst](https://github.com/vyayasan/kyc-analyst) | 4-factor weighted scoring, stagegate consent, immutable case folders, public-source-first |
| [jube-home/aml-fraud-transaction-monitoring](https://github.com/jube-home/aml-fraud-transaction-monitoring) | behavioral features (velocity/volume/geo), rules+ML dual layer |
| [Agentic LLM Adverse-Media paper](https://www.researchgate.net/publication/401417566) | Adverse Media Index, retrieve→score |
| [NadirClaw](https://github.com/NadirRouter/NadirClaw) / [model-router-ai](https://github.com/nandth/model-router-ai) | embedding-gated cost cascade, escalate on low confidence |
| [Cost-Saving Cascades (arXiv 2502.09054)](https://arxiv.org/pdf/2502.09054) | early abstention |
| [SAML-D](https://www.kaggle.com/datasets/berkanoztas/synthetic-transaction-monitoring-dataset-aml) / [IBM AMLSim](https://github.com/IBM/AMLSim) / [Nature SynthAML](https://www.nature.com/articles/s41597-023-02569-2) | AML typologies to imitate; ~0.1% suspicious base rate; inject known label = ground truth |

GitHub dorks: `site:github.com KYC drift detection`, `... AML transaction monitoring LLM`,
`... adverse media screening RAG`, `... LLM cascade router cost aware`.

---

## 15. Build runbook & locked decisions / 실행 순서·결정

**Locked decisions:**
- **D1** Dashboard first; RAG chatbot a secondary panel.
- **D2** Backend + frontend separate folders (secrets only backend).
- **D3** Secrets in `backend/.env` (git-ignored); `.env.example` committed.
- **D4** Embeddings: ship `simpleEmbed` (free) now → swap to Voyage (backend-only) if time. Cache
  baseline + archetypes once; only the live signal is embedded each time.
- **D5** EventRegistry = live Stage-1 news source.

**Execution order:** lock demo company → confirm wired MCP sources → generate Layer-2 baseline +
4-factor risk rating + synthetic tx (normal / spike / dormancy) → embeddings → rules → hard gate →
**Stage 2 (priority #1)** → weighted scoring → calibrate weights on README's 10 rows → Stage 3 →
UI → cost table → rehearse. Cut order if short: keep Stage 2 + hard gate + scoring; trim UI polish,
Stage 3, cost table last.

---

## 16. Progress & roadmap / 진행·로드맵 (2026-06-20)

**✅ Done:** full pipeline; riskPolicy.json; fraud formulas + eval (5/5); weak-signal filter;
per-signal suggestedAction + fraud badge; live news; multi-model synthetic generator + ground-truth
labels; Postgres layer; team integration (news/kyc/sanctions adapters) → /api/portfolio; Kiara
sanctions → hard gate; per-signal HITL (validate/dismiss/note); dashboard Demo/Portfolio toggle;
**two-tier sanctions screening** (auto ≥98 / review 85–98 + jurisdiction check + review-queue
banner); **per-stage hybrid LLM** (Stage 2 local gemma / Stage 3 Claude, policy via
STAGE2_PROVIDER/STAGE3_PROVIDER); **TSLM-lite** time-series summary injected into Stage 3;
**drift taxonomy expanded to 19 categories** (weights + recommended actions).

**🔜 My TODOs:** run Giulio `signal_extractor.py` → kyc_drift_signals.json; run Kiara
`screen_portfolio.py` → sanctions_hits.json; scrapers → Postgres + 24h scheduler; demo script +
cost table + Q&A; integration→main merge (or present from integration).

**💡 Future:** expand drift taxonomy to ~20 (§5); homonym disambiguation + two-tier fuzzy queue
(§10); **Jury model** (2 debating models + judge, HIGH only) — jury differentiator; PDF/CSV export;
contagion via `linked_entities`; regression-fit weights on real outcomes.

---

## 17. How to run / 실행법

```bash
# backend
cd backend && npm install
cp .env.example .env            # optional keys (runs keyless with stubs)
npm run dev                     # API :8787
npm run demo                    # 3 demo cases (LOW / HIGH+escalation / CRITICAL)
npm run demo:ingest             # team KYC db + news → pipeline
npm run demo:live -- "Wirecard AG"   # one real-news case (needs EVENTREGISTRY_API_KEY)
npm run eval                    # accuracy: predicted vs injected ground-truth (5/5)
npm run generate                # multi-model synthetic data (needs ≥1 provider key)
npm run db:init                 # create Postgres tables (needs DATABASE_URL)

# frontend
cd frontend && npm install && npm run dev    # :5173 → Demo / Team portfolio toggle

# scrapers (Python, team)
cd scrapers && pip install -r requirements.txt
# news-feed: python helpers/signal_extractor.py     → kyc_drift_signals.json
# sanctions: python sanctions/screen_portfolio.py    → data/sanctions_hits.json
```
