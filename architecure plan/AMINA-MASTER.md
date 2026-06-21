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
┌──────────── LAYER 1: public signals (Python, scrapers/) ────────────-----------------------
│  news-feed (Giulio)        corporate (Alice)       sanctions (Kiara) │       domain (Maiya) │ 
│  RSS→NER→gemma3:4b 필터     등기 비교                OFAC/UN fuzzy      │                      │ 
│  → kyc_drift_signals.json   → 관할/법인형태 변경      → 이름 매칭        │                         │ 
└───────┬──────────────────────────┬──────────────────────┬────────────-----------------------
        ▼ (24h → Postgres)          ▼                      
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
| Stage 1 | 체온계 | rules + embeddings (+ Giulio gemma3:4b pre-filter) | free/local | everyone |
| Stage 2 | 피검사 | **local gemma3:4b (free) OR Claude Haiku 4.5** | free or cheap | flagged only |
| Stage 3 | MRI | **local gemma OR Claude Sonnet 4.6** | free or paid | HIGH only |

**EN.** Don't run the expensive model on everyone. Cheap filters drop most; only the risky few reach
the reasoning models. This is the challenge's explicitly-judged **cost efficiency** (20%).

**LLM modes (per-stage, via env — see `llm.ts`):** `OLLAMA_MODEL` runs a stage on a **free local
model**; `ANTHROPIC_API_KEY` runs it on Claude; absent both → deterministic stub. `STAGE2_PROVIDER` /
`STAGE3_PROVIDER` force a stage. **Three modes:**
- **All-free:** `OLLAMA_MODEL=gemma3:4b` → Stage 2 & 3 both local, $0.
- **Hybrid (recommended):** `OLLAMA_MODEL=gemma3:4b` + `ANTHROPIC_API_KEY` + `STAGE3_PROVIDER=anthropic`
  → Stage 2 free local (high volume), Stage 3 Claude (quality where it matters).
- **All-quality:** `ANTHROPIC_API_KEY` only.
- **Swiss-sovereign:** `STAGE3_PROVIDER=apertus` + `APERTUS_API_KEY` → Stage 3 runs on **Apertus**
  (Swiss open LLM, EPFL/ETH/CSCS) — keeps reasoning on a Swiss/European model, a strong
  data-sovereignty story for a Swiss bank. Pairs well with local gemma on Stage 2 (zero US cloud).
The Jury reuses this: prosecutor/defense on the Stage-2 tier, judge on the Stage-3 tier.

**Two-model FREE stack (zero API keys) / 무료 2-모델 스택.** The two ML jobs already have free
Hugging Face models:
- **Filtering / embeddings** — `Xenova/all-MiniLM-L6-v2` via Transformers.js (`EMBED_BACKEND=transformers`).
  Free, local, no key. **Already on.** This is the "transformer model" half.
- **Reasoning (Stage 2/3)** — **Gemma** (`OLLAMA_MODEL=gemma3:4b`) via Ollama. Free, local, no key.
  Replaces Apertus/Claude.

So the fully-free combo = **MiniLM (filtering) + Gemma (reasoning)**, both HF, $0, no keys.
⚠️ **Practical note:** run Gemma via **Ollama** (fast quantized server: `brew install ollama` →
`ollama pull gemma3:4b` → `ollama serve`), NOT via Transformers.js — a 2–4B chat model in
Node/WASM is far too slow for reasoning over ~90 signals (Transformers.js is fine for the small
MiniLM embedding model only). 임베딩은 Transformers.js(MiniLM)로 무료, 추론 Gemma는 Ollama로 돌려야 빠름.

**Current default (this session):** Stage 3 + jury on **Apertus** (`STAGE3_PROVIDER=apertus`,
sovereignty story); Stage 2 on `stub` until Ollama is installed. Embeddings already on free MiniLM.
To go fully free: install Ollama, set `OLLAMA_MODEL=gemma3:4b`, blank `STAGE2_PROVIDER`/`STAGE3_PROVIDER`/`APERTUS_API_KEY`.

**KR.** Stage 2는 **무료 로컬 gemma 또는 유료 Haiku 둘 다 지원** — env로 선택. 권장은 **하이브리드**
(Stage 2 로컬 무료 + Stage 3 Claude/Apertus 고품질). 비싼 모델은 위험한 소수만.

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

### 9.1 The actual weights / 실제 가중치 (`riskPolicy.signalWeights`)

| Weight | Dimension(s) | Tier — why / 왜 |
|---|---|---|
| 20 | business_model_pivot | **Highest.** Client becomes a *different company* than onboarded. 온보딩과 다른 회사가 됨 |
| 16 | pep_exposure | FATF high-risk: politically exposed person. PEP 고위험 |
| 15 | ownership_change · nominee_ownership | Hidden control / beneficial-owner change. 실소유주 은닉 |
| 14 | cross_border_anomaly · structuring_pattern | Active AML typologies (mule, smurfing). 능동적 자금세탁 전형 |
| 12 | legal_regulatory_action · unexplained_volume_surge | Real but not definitive. 실재하나 확정 아님 |
| 10 | jurisdiction_change | Structural but can be legitimate. 구조적이나 합법 가능 |
| 8 | dormancy_break · negative_news · legal_form_change | Moderate. 중간 |
| 6 | key_personnel_change · rapid_geographic_expansion | Often benign. 흔히 양성 |
| 3–5 | domain · entity_name · website · sentiment · funding_scale | **Lowest** — cosmetic/weak. 표면적·약함 |

`MAX_WEIGHT = 20`, `softeningFactor = 0.3`, `flagBands = { mediumFrom: 30, highFrom: 60 }`.

### 9.2 How a score is built — two levels / 점수 계산 2단계

**EN.** `weight/MAX_WEIGHT` is **one dimension's** weight ÷ 20 (NOT a sum) — it normalizes importance to
0–1. The **sum (Σ) happens across signals**, not across weights:
```
LEVEL 1 (per signal):  contribution = magnitude × (thisWeight / 20) × confidence
LEVEL 2 (across fired signals):  compositeScore = Σ contributions   → clamp [0,100] → riskFlag
```
**KR.** `weight/MAX_WEIGHT`는 **한 차원의 가중치 ÷ 20** (합 아님) — 중요도를 0~1로 정규화. **합산(Σ)은
신호들 사이에서** 일어남(가중치를 더하는 게 아님). 차원이 발화하면 → 그 기여도를 전부 더해 → 총점 → 플래그.

### 9.3 Worked example — NordPay (scored 100 → HIGH) / 계산 예시

| Dimension | magnitude | weight | conf | contribution = m × (w/20) × c |
|---|---|---|---|---|
| business_model_pivot | 81 | 20 | 0.62 | 81 × 1.00 × 0.62 = **50.2** |
| cross_border_anomaly | 100 | 14 | 0.90 | 100 × 0.70 × 0.90 = **63.0** |
| dormancy_break | 61 | 8 | 0.85 | 61 × 0.40 × 0.85 = **20.7** |

`Σ = 50.2 + 63.0 + 20.7 = 133.9 → clamp 100 → HIGH`. **EN.** The news pivot (50) *alone* = MEDIUM;
added to the two transaction typologies it crosses 60 → HIGH. That's the "news + transaction combine"
in numbers. **KR.** 뉴스 신호만(50)이면 MEDIUM, 거래 전형 2개를 더하면 60 넘어 HIGH — "뉴스+거래 합산"의 수치적 증거.

### 9.4 Honest provenance / 솔직한 출처

**EN.** Be precise with a judge: the tier **ordering** follows FATF/Basel (real standards — BO opacity &
PEP are high-risk). The **exact integers** (20, 16, …) and the **30/60 bands** are **expert-set policy**
in a swappable config, **calibrated on the README's 10 scenarios — not extracted from a paper, not yet
data-fitted** (regression-fit on labeled outcomes is the stated next step). 60-for-HIGH is deliberate:
one top-weight high-confidence high-magnitude signal alone reaches HIGH (e.g. business_model_pivot
100 × 1.0 × 0.6 = 60). **KR.** 심사에서 정확히: **순서(tier)**는 FATF/Basel(실제 표준) 근거. **숫자(20,16…)와
30/60 경계**는 **전문가가 설정한 정책값**(교체 가능한 config), README 10개 시나리오로 보정 — **논문에서 뽑은 게 아니고,
아직 데이터로 학습한 것도 아님**(라벨 데이터 회귀학습이 다음 단계). 60=HIGH는 의도적 — 최고가중치 신호 하나로도 HIGH 도달.

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

> **UBO = Ultimate Beneficial Owner / 실소유자.** The real human who ultimately owns or controls
> the company (typically ≥25% ownership), even if hidden behind shell layers. We screen **the
> company legalName AND every UBO name** against sanctions/PEP — a clean company with a sanctioned
> or PEP owner still gates to CRITICAL. UBOs live on `ClientBaseline.ubos[] {name, ownershipPct, isPEP}`.

**Isolated test / 단독 테스트** — `npx tsx backend/src/testSanctions.ts` checks 5 cases with NO
server/pipeline: ① sanctioned company name ② clean ③ clean company but UBO on list ④ PEP UBO
⑤ case/whitespace variant. Each prints `expect` vs `got` so you can demo "name → CRITICAL"
matching directly. Name matching is normalized (`normName()`) so case/spacing/punctuation
variants ("Acme Ltd." vs "Acme Ltd") still match. 이름 매칭은 정규화되어 대소문자·공백·문장부호 변형도 매치.

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
| Maiya(domain)| 

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

**Latest changes & solutions / 최근 변경·해결 (this session):**
- **News sentiment wired as a free Stage-1 signal (`sentimentAdapter.ts`).** Giulio's pipeline
  has TWO separate free tools — **Gemma3:4b screens which articles to keep** (Ollama), then
  **VADER scores sentiment** (`sentiment_enrich.py`, `method: "vader+finance-lexicon"`, NOT an
  LLM). We read the company-level `sentiment_score` (`score`, `risk_polarity`, `adverse_ratio`)
  and emit a deterministic pre-scored signal — no model on our side: net-negative/high-polarity →
  `negative_sentiment` risk signal (Terraform 0.86 → magnitude 86); net-positive → a `positive`
  softener (bounded by `softeningFactor`, never cancels the hard gate); neutral → nothing. Feeds
  the composite alongside registry + contagion. **Sentiment ≠ Gemma:** Gemma filters news, VADER
  scores it, our backend just reads VADER's numbers. (Gemma only enters our side if Stage 2/3 use
  Ollama.) **Positive-flag policy (EN):** positive news only *discounts* the score (≤30% softening);
  it can never cancel a sanctions/PEP hard gate — good PR can't hide a real red flag.
- **`.gitignore` footgun fixed (unanchored patterns).** `data/` and `pipeline/` (no leading
  slash) matched those folder names at EVERY level, so they silently ignored `frontend/src/data/`,
  `backend/src/data/` and `backend/src/pipeline/` — files looked committed but never left the
  author's machine. Symptom: vite build failed with `Failed to resolve "./data/kyc_sanctions_flags.json"`.
  Fix: root-anchor → `/data/`, `/pipeline/`; restored the 3 missing `frontend/src/data/*.json`
  bundled fallbacks from their real sources. **Lesson:** in `.gitignore`, write `/folder/` (leading
  slash) for a specific root folder; without it the name is ignored everywhere, source code included.
- **End-to-end pipeline proof (`npm run health`).** A single check (`src/pipelineHealth.ts`)
  traces every link — source files → Postgres → Layer-2 txs → pipeline scoring → REST API →
  frontend — and prints PASS/FAIL. Latest run: **18 passed, 0 failed → PIPELINE HEALTHY** (10/10
  clients scored, flags discriminating 9 high/1 medium, 3 transaction typologies fire). This is the
  reproducible way to show a teammate the whole system works.
- **LLM provider is a hot-swappable env switch (`STAGE2_PROVIDER`/`STAGE3_PROVIDER`).** Values:
  `anthropic` (Claude — fast, reliable, recommended for the demo), `apertus` (Swiss LLM — sovereignty
  story, but the free `api.publicai.co` tier was returning 504/404 this session, making the portfolio
  crawl to ~130s), `ollama` (free local Gemma), `stub` (deterministic template, no AI — instant, free,
  never fails; rationale tagged `[STUB]`). When Apertus went down we set `STAGE3_PROVIDER=stub` so the
  demo stays fast/stable; switch to `anthropic` (with key) for fast real reasoning. The slowness was
  the external LLM, **not** the pipeline (health check stays green on stub).
- **Synthetic transaction history wired into the live portfolio (Layer-2 numeric).** Real bank
  transaction data is private, so we generate it (`data/generators/genTransactions.ts` →
  `data/synthetic_transactions.json`, loaded by `txAdapter`) **anchored to** each client's real
  KYC baseline (expected volume + jurisdiction → `expectedCounterpartyRegions`, now set from
  jurisdiction in `kycAdapter`) and to the **FATF/AML typology thresholds** in `riskPolicy`
  (CTR $10k, structuring band, 180-day dormancy, 0.8 pass-through). 7 of 10 clients are clean;
  3 carry an injected typology matching their story — **Terraform** (dormancy-break + money-mule,
  collapse), **Bybit** (structuring), **JPEX** (money-mule). The portfolio appends a
  `sourceType:"transaction"` trigger signal so `ruleDiff` runs; verified discriminating (7 clean /
  3 dirty). **Honest framing:** synthetic but profile-anchored — plugs into a real bank's
  transaction feed unchanged. *(AML = Anti-Money-Laundering; the 3 patterns are classic laundering
  typologies the rules catch.)*
- **All Layer-1 sources → Postgres → pipeline → API.** `db:ingest` now loads KYC baselines
  (`docs/kyc_database.json`), Giulio's news, Alice's corporate registry drift
  (`scrapers/corporate/kyc_drift_report.json` → `registry` signals), and Kiara's
  `scrapers/sanctions/kyc_sanctions_flags.json` → a new `sanctions_hits` table. `hardGate`
  reads the watchlist from Postgres (Kiara-file → DEMO fallback). Verified end-to-end:
  10 baselines, 93 signals (news 92 + registry 1), 5 sanctions hits; "Banco Nacional de Cuba"
  (Kiara-only) → CRITICAL via the DB watchlist.
- **Apertus (Swiss LLM) wired as reasoning engine.** `llmMode()` falls back to `apertus` when
  only `APERTUS_API_KEY` is set. **Recommended hybrid** (`STAGE2_PROVIDER=stub`,
  `STAGE3_PROVIDER=apertus`): Stage 2 stays fast across all signals, Apertus runs Stage 3 +
  jury on HIGH cases — keeps the portfolio responsive while showcasing the sovereignty story.
- **Robust JSON parsing for open models.** Apertus 70B sometimes emits trailing commas or
  prose with no JSON. `extractJSON` strips trailing commas; Stage 2 / Stage 3 / jury each
  degrade gracefully (keep the model's text as rationale) instead of 500-ing the case.
- **Parallel portfolio scoring.** `/api/portfolio/alerts` scores all 10 clients concurrently
  (`Promise.all`) → wall-clock dropped from a 180s timeout to **~9.5s** with live Apertus.
- **Isolated sanctions test** `npx tsx backend/src/testSanctions.ts` (5 name-match cases).

**✅ Done:** full pipeline; riskPolicy.json; fraud formulas + eval (5/5); weak-signal filter;
per-signal suggestedAction + fraud badge; live news; multi-model synthetic generator + ground-truth
labels; Postgres layer; team integration (news/kyc/sanctions adapters) → /api/portfolio; Kiara
sanctions → hard gate; per-signal HITL (approve/reject/escalate/note); dashboard Demo/Portfolio toggle;
**two-tier sanctions screening** (auto ≥98 / review 85–98 + jurisdiction check + review-queue
banner); **per-stage hybrid LLM** (Stage 2 local gemma / Stage 3 Claude, policy via
STAGE2_PROVIDER/STAGE3_PROVIDER); **TSLM-lite** time-series summary injected into Stage 3;
**drift taxonomy expanded to 19 categories** (weights + recommended actions + archetypes);
**adversarial Jury** on HIGH cases (prosecutor vs defense → judge, policy-gated `riskPolicy.jury`);
**Postgres 24h ingestion** (`db:ingest` / `scheduler` / `db:status`, interval via INGEST_INTERVAL_MS);
**Apertus** (Swiss LLM) provider + backend landing page + per-signal approve/reject/escalate;
**real semantic embeddings** option via Transformers.js (`EMBED_BACKEND=transformers`,
all-MiniLM-L6-v2, free local); **Postgres-backed portfolio API** (scrapers→DB→API→UI loop closed:
`/api/portfolio/alerts` reads from Postgres, falls back to JSON); cost strip removed from dashboard.
**Full free run verified:** transformers embeddings + stub LLM, no keys, demo flags still LOW/HIGH/CRITICAL.

**All three Layer-1 sources now flow scrapers → Postgres → pipeline → API → UI:**
`db:ingest` loads (a) KYC baselines from `docs/kyc_database.json`, (b) Giulio's news +
(c) Alice's corporate registry drift (`scrapers/corporate/kyc_drift_report.json` → `registry`
signals) into the `signals` table, and (d) Kiara's `scrapers/sanctions/kyc_sanctions_flags.json`
into a new `sanctions_hits` table. `hardGate` reads the watchlist from Postgres (Kiara-file →
DEMO fallback). `/api/portfolio/alerts` scores all 10 real clients from the DB (`source:postgres`).
Verified: "Banco Nacional de Cuba" (only in Kiara's data) → CRITICAL via the DB watchlist.

**🔜 My TODOs:** install Ollama gemma for free real reasoning text; demo script + Q&A;
integration→main merge (or present from integration).

**💡 Future:** PDF/CSV export; contagion via `linked_entities` (Giulio's linked-entity graph);
regression-fit weights on real labeled outcomes; numeric rules for the remaining new drift
dimensions; calibrate `riskPolicy.json` to the 10 mock clients.

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
npx tsx src/testSanctions.ts    # isolated sanctions hard-gate test (5 name-match cases)
npm run health                  # END-TO-END proof: files→DB→pipeline→API→frontend (PASS/FAIL)
npm run gen:tx                  # regenerate synthetic transactions (data/synthetic_transactions.json)
npm run generate                # multi-model synthetic data (needs ≥1 provider key)
npm run db:init                 # create Postgres tables (needs DATABASE_URL)

# frontend
cd frontend && npm install && npm run dev    # :5173 → Demo / Team portfolio toggle

# scrapers (Python, team)
cd scrapers && pip install -r requirements.txt
# news-feed: python helpers/signal_extractor.py     → kyc_drift_signals.json
# sanctions: python sanctions/screen_portfolio.py    → data/sanctions_hits.json
```
