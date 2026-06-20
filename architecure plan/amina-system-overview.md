# AMINA — 통합 시스템 전체틀 (System Overview)

> 팀 Python 스크래퍼 + 우리 TS 파이프라인/대시보드가 어떻게 하나로 연결되는지.
> `integration` 브랜치 기준.

---

## 한 장 다이어그램

```
┌──────────────── LAYER 1: 공개 신호 수집 (Python, scrapers/) ────────────────┐
│                                                                              │
│  news-feed/ (Giulio)          corporate/ (Alice)        sanctions/ (Kiara)   │
│  RSS → 본문 → NER(회사)        등기 비교 (ZEFIX/         OFAC/UN +            │
│  → gemma3:4b LLM 스크리닝       OpenCorporates)          fuzzy matcher        │
│  → kyc_drift_signals.json      → 관할/법인형태 변경       → 이름 매칭          │
│         │                            │                        │              │
└─────────┼────────────────────────────┼────────────────────────┼──────────────┘
          │                            │                        │
          ▼ (24h마다 → DB, backend/DATABASE.md)                 │
┌──────────────── 어댑터 (TS, backend/src/ingest/) ──────────┐  │
│  newsAdapter: 7 dimension → SignalCategory                 │  │
│  kycAdapter:  kyc_database.json → ClientBaseline           │  │
└─────────┬──────────────────────────────────────────────────┘  │
          │ RawSignal[] + ClientBaseline                         │ {matched, entity}
          ▼                                                      ▼
┌──────────────── LAYER 2 + 스코어링 파이프라인 (TS, backend/src/pipeline/) ───┐
│                                                                              │
│  classifyRawSignal() 라우팅                                                   │
│    ├ numeric    → ruleDiff (fraud 전형: structuring/mule/dormancy)           │
│    ├ narrative  → 임베딩 게이트 → Stage 2 (Haiku) 분류                        │
│    └ identity   → hardGate (제재 정확매칭) ◄── Kiara                          │
│         │                                                                    │
│         ▼ SignalScore[] (저신뢰 컷: conf<0.4 & mag<50)                        │
│  computeCompositeScore (정책 가중치, config/riskPolicy.json)                  │
│         │                                                                    │
│         ▼ riskFlag (low/med/high/critical)                                   │
│  HIGH → Stage 3 (Sonnet) 정밀 보고서                                          │
└─────────┬────────────────────────────────────────────────────────────────────┘
          │
          ▼  REST API (backend/src/server.ts)
   /api/demo/alerts      (3개 데모 케이스)
   /api/portfolio/alerts (팀 10개 기업 ← 어댑터)
   /api/decision, /api/audit, /api/cost
          │
          ▼  대시보드 (TS, frontend/)
   Alert Queue · Detail(시그널/근거/citations) · 승인·거부(HITL) · Audit · Cost
   토글: [Demo cases] / [Team portfolio]
```

---

## 폴더 = 책임

| 폴더 | 언어 | 담당 | 역할 |
|---|---|---|---|
| `scrapers/news-feed/` | Python | Giulio | RSS + NER + LLM drift 스크리닝 |
| `scrapers/corporate/` | Python | Alice | 등기 변경 감지 |
| `scrapers/sanctions/` | Python | Kiara | 제재 명단 매칭 |
| `data/` | JSON | 공유 | `kyc_database.json` (Layer 2) |
| `backend/src/ingest/` | TS | 우리 | 어댑터 (팀 출력 → RawSignal/Baseline) |
| `backend/src/pipeline/` | TS | 우리 | 라우팅 + 룰 + Stage2/3 + 스코어링 |
| `backend/` | TS | 우리 | REST API + Postgres |
| `frontend/` | TS | 우리 | 컴플라이언스 대시보드 |

---

## 계약 (Contract) — 이것만 맞추면 통합됨

```ts
// 모든 스크래퍼가 이 형식으로만 출력하면 파이프라인이 자동 처리
RawSignal { signalId, clientId, category, detectedAt, sourceType, sourceUrl?, rawText? }
// 제재는 예외: { matched: boolean, matchedEntity? } → hardGate
```

---

## 비용 계층 (cost tiering) — 평가자 핵심

```
1. Giulio gemma3:4b (로컬, 공짜)  → 뉴스 거름 + drift 차원 태깅
2. 임베딩 게이트 (공짜)            → 의미 드리프트 1차 필터
3. ruleDiff (공짜 산수)           → 거래 fraud 전형
4. Stage 2 Haiku (싼 유료)        → 살아남은 신호만 점수화
5. Stage 3 Sonnet (비싼 유료)     → HIGH만 정밀 보고서
```
→ 비싼 모델은 위로 갈수록 적게 호출. 공짜 필터가 대부분을 거름.

---

## 실행 (전체 데모)

```bash
# 백엔드
cd backend && npm install && npm run dev          # :8787
# 프론트
cd frontend && npm install && npm run dev         # :5173 → 토글로 Demo/Portfolio

# 팀 데이터 엔드투엔드 (터미널)
cd backend && npm run demo:ingest                 # KYC db + 뉴스 → 점수
npm run eval                                       # 정확도 (정답 라벨 vs 예측)
npm run demo:live -- "Wirecard AG"                # 실제 뉴스 1건
```

---

## 진행 상황 (Progress) — 2026-06-20

### ✅ 완료
- 전체 파이프라인 (하드게이트 → 라우팅 → 룰/임베딩/Stage2 → 스코어링 → Stage3)
- 정책 파일 `riskPolicy.json` (모든 튜닝값 1곳 → 다른 회사 = 파일만 교체)
- fraud 전형 3종 공식 (structuring/mule/dormancy) + 정확도 평가 `npm run eval` (5/5)
- 저신뢰 시그널 컷, per-signal `suggestedAction`, fraud 배지
- 라이브 뉴스 (`demo:live`), 멀티모델 합성 생성기 + ground-truth 라벨
- Postgres 레이어 (`db.ts`, `schema.sql`, `db:init`)
- **팀 통합**: 어댑터(news/kyc/sanctions) → `/api/portfolio/alerts` → 대시보드 토글
- **Kiara sanctions → 하드게이트** 연결 (브릿지 `screen_portfolio.py`)
- **시그널별 HITL 버튼** (✓검증 / ✗기각, 개별 신호마다 + 감사로그)

### 🔜 내가(팀이) 더 할 것
- [ ] Giulio `signal_extractor.py` 실행 → `kyc_drift_signals.json` (그래야 portfolio에 점수 뜸)
- [ ] Kiara `screen_portfolio.py` 실행 → `data/sanctions_hits.json` (실제 OFAC/UN hit)
- [ ] 스크래퍼 → Postgres 저장 + 24h 스케줄러 (`node-cron`)
- [ ] 발표: 3분 데모 대본 + cost 표 + 예상 질문
- [ ] integration → main 머지 (또는 integration에서 발표) — 폴더 이동 충돌만 해결

### 💡 발전시키면 좋을 것 (Future)
- **drift 차원 확장** (지금 우리 10개): `domain_change`(Wayback/Firecrawl), `entity_name_change`(GLEIF/ZEFIX), `pep_exposure`(OpenSanctions PEP), `nominee_ownership`(ICIJ Offshore Leaks), `negative_sentiment`(뉴스 감성). 소스 = FATF 적색신호 + README 10개 표.
- **제재 정확성 (동명이인 문제)**: 이름만 매칭하면 다른 회사 오탐. **2차 식별자(관할/LEI/주소/entity_type)로 대조** → 불일치 시 자동 차단 대신 사람 검토 큐.
- **fuzzy + 사람 검토 큐 (2단계)**: `≥98 + 식별자 일치 → 자동 CRITICAL`, `85~98 → 검토 큐`. 임계값을 `riskPolicy.json`에 정책화.
- **Jury 모델 (#5)**: 2개 모델이 "위험 vs 정상" 논쟁 → 판정관이 점수로 결정 (고위험 후보에만). 평가자 차별화 포인트.
- **PDF/CSV 다운로드 (#4)**: 케이스 보고서 내보내기.
- **contagion(전염) 활성화**: Giulio의 `linked_entities`로 연관사 위험 전파 (A↔B 관계 그래프).
- **실측 라벨로 weight 회귀학습**: 합성 → 실데이터 결과가 쌓이면 가중치 재학습 (로드맵).
