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

## 남은 통합 작업

- [ ] Giulio `signal_extractor.py` 실행 → `kyc_drift_signals.json` 생성 (그래야 portfolio에 점수 뜸)
- [ ] Kiara `matcher.py` 출력 → `hardGate` 어댑터 연결 (지금 데모 stub)
- [ ] 스크래퍼 → Postgres 저장 (24h 스케줄러)
- [ ] (로드맵) 시그널별 HITL 버튼, Jury 모델, PDF/CSV
```
