# AMINA — 평가자(Jury) 피드백 로드맵 & 통합 계획

> 평가자 면담(2026-06-20) 내용을 실행 가능한 작업으로 정리. 팀 공유용.

---

## 0. 평가자가 준 큰 방향 (요약)

- **모든 usecase/회사를 다 볼 필요 없다** — 몇 개만 정해서 **깊게** 파고들고 데모로 보여줘도 됨.
- 대신 **확장 가능**해야 함 — 다른 회사가 써도 **파라미터(정책)만 바꾸면** 바로 동작.
- 가중치는 자유지만 **정확한 로직(exact logic)** 이 있어야 함.
- 데이터는 **DB에 주기적으로 저장(24h)** 하는 구조로.
- **Jury 모델**(2개 모델이 논쟁 → 판정관이 점수로 결정)이 있으면 좋겠다.
- **시그널별** human-in-the-loop 버튼 (전체 1개 말고).
- 저신뢰 시그널은 **잘라내라** (예: confidence<40% & magnitude<50).
- **PDF/CSV 다운로드** 기능.
- **외부 데이터셋**으로 합성 데이터 생성.
- Layer 2는 더 풍부하게 (투자자 등 복잡한 정보).

---

## 1. 우선순위 로드맵

| # | 평가자가 말한 것 | 우리 상태 | 작업량 | 우선 |
|---|---|---|---|---|
| 1 | 저신뢰 시그널 컷 (conf<40%, mag<50) | ✅ 완료 (정책 `signalFilter`) | — | ✅ |
| 2 | 펀딩 = good flag 가능 | ✅ 이미 (`direction:positive` + softening) | — | ✅ |
| 3 | **시그널별** human-in-the-loop 버튼 | ⚠️ 지금은 전체 1개 | 낮음 | 🔥 바로 |
| 4 | PDF/CSV 다운로드 | ❌ | 중 | 🔥 바로 |
| 5 | **Jury 모델** (2개 논쟁 + 판정) | ❌ (지금 Stage 2/3 단일) | 중상 | ⭐ 차별화 |
| 6 | DB에 24h마다 저장 (RSS→DB) | ❌ (지금 실시간/메모리) | 큼 | ⭐ 확장성 |
| 7 | 모든 소스 사용 (뉴스/등기/제재) | ⚠️ 뉴스만 라이브 | 통합 | 👥 팀 |
| 8 | Layer 2 풍부하게 (투자자 등) | ⚠️ 기본만 | 낮음 | 스키마 |
| 9 | 외부 데이터셋으로 합성 | ⚠️ 생성기 있음 | 중 | 데이터 |

**추천 빌드 순서:** 3(시그널별 버튼) → 5(Jury 모델, 최대 차별화) → 4(PDF/CSV) → 6(DB+스케줄러).

---

## 2. 팀 브랜치 통합 — "다 가져와야 하나?" → 네, `RawSignal`로 통일

각자 브랜치를 **코드 병합이 아니라 "출력 형식 통일"** 로 합친다. 각 스크래퍼는 결과를
우리 공통 스키마(`RawSignal`)로만 내보내면, main의 파이프라인이 알아서 라우팅한다.

| 팀원 | 하는 것 | 우리 구조에서 | 출력 형식 (계약) |
|---|---|---|---|
| **Kiara** | 제재명단 스크랩·매칭 | **하드게이트** (정확매칭 → 즉시 차단) | `{ matched: boolean, matchedEntity?, sourceUrl? }` |
| **Giulio** | RSS 뉴스 + 유사도 + 긍/부정 | Layer 1 narrative | `RawSignal { sourceType:"news", rawText, sourceUrl }` |
| **Alice** | 기업 등기 스크랩 | Layer 1 narrative | `RawSignal { sourceType:"registry", rawText, sourceUrl }` |
| **당신** | 거래/펀딩 위험 로직 | Layer 2 numeric | `RawSignal { sourceType:"transaction" / "funding_db" }` |

```ts
// 공통 계약 (backend/src/types.ts)
interface RawSignal {
  signalId: string;
  clientId: string;
  category: SignalCategory;
  detectedAt: string;
  sourceType: "news" | "registry" | "domain" | "transaction" | "funding_db";
  sourceUrl?: string;
  rawText?: string;        // narrative
  newsQuery?: string;      // live news
  rawNumeric?: number;     // numeric
  rawNumericContext?: Record<string, number>;
}
```

**액션:** 팀에 "각자 스크래퍼는 `RawSignal[]`(또는 하드게이트는 `{matched,...}`)만 리턴하자"고
공유. 그러면 우리 `pipeline.ts`가 통합 지점이 된다.

### Giulio의 contagion(전염) 아이디어
"A 회사가 B 제품을 쓰면, B가 나빠질 때 A도 위험" — 고급 기능. 관계 그래프가 필요하므로
**나중에**. 우선은 각 회사 단독 신호부터.

---

## 3. 평가자가 물은 개념들 (정리)

### Q. 스크래핑은 미리? 실시간?
→ **주기적으로 스크랩해서 DB 저장(24h)**. 이유: **드리프트는 "지금 vs 과거" 비교**라
과거 데이터가 저장돼 있어야 한다. 실시간만 하면 (1) 느림 (2) rate limit (3) 과거 없음 → 변화 못 잡음.
구조: `스케줄러(24h) → 스크랩 → DB → 파이프라인은 DB에서 읽음`. (현재 EventRegistry 실시간 호출은
데모용이고, 확장형은 DB 캐시.)

### Q. 합성 Layer 2도 진짜 정보 기반이어야?
→ **그렇다.** 실제 회사의 공개 발자국(업종·펀딩·관할)으로 KYC 프로필을 만들고, **거래 숫자만 합성**.
(Ostium 처럼: 펀딩은 진짜, 거래내역은 가짜.) 평가자: "외부 데이터셋으로 합성 만들라."

### Q. Layer 1 + Layer 2 합칠 때 따로 계산?
→ **아니다. 같은 스코어링 엔진에서 합산**. 뉴스든 거래든 각각 `SignalScore`가 되고,
전부 하나의 `computeCompositeScore()` 가중합으로 들어간다. "뉴스+거래 합쳐본다" = 둘 다 같은
점수식에 기여. (이미 그렇게 구현됨.)

### Q. 펀딩이 좋은 소식이면?
→ `direction: "positive"` 로 분류되면 점수를 **깎는다(softeningFactor)**. 즉 "good flag"도 표현됨.

---

## 4. 이미 충족한 평가자 요구 (자랑 포인트)

- **확장성(파라미터만 바꾸면)**: 모든 튜닝값이 `config/riskPolicy.json` 단일 파일.
  새 기관 = 이 파일만 교체 (코드 변경 0).
- **정확한 로직**: `compositeScore = Σ(magnitude × weight/maxWeight × confidence) − softening`,
  `flag = score<30 low / <60 medium / else high`. 전부 문서화(spec §6.5, §9).
- **저신뢰 컷**: `signalFilter { minConfidence:0.4, minMagnitude:50 }` — 둘 다 약하면 버리고 audit 기록.
- **정확도 측정**: `npm run eval` — 주입한 정답 라벨 vs 예측, 현재 5/5(100%).

---

## 5. Jury 모델 설계 스케치 (#5, 차별화)

지금: Stage 2에서 1개 모델이 단독 분류.
제안: **2개 모델이 논쟁 → 판정관이 결정**.

```
시그널 → ┌ 모델 A ("위험하다" 입장) ─┐
         │                            ├─→ 판정관 모델(Judge)
         └ 모델 B ("정상이다" 입장) ─┘     → 최종 direction + confidence + 근거
```

- 컴플라이언스 친화적: "양쪽 주장을 다 듣고 판정" = 설명가능성·감사 가능성 ↑
- 비용: 호출 3회로 늘어남 → **고위험 후보에만** 적용 (싼 1차 필터는 그대로)
- 출력에 "A 주장 / B 반론 / 판정 이유"를 담아 대시보드에 표시 → 강력한 데모

---

## 6. 다음 액션 체크리스트

- [ ] (#3) 시그널별 승인/거부 버튼 — 프론트
- [ ] (#5) Jury 모델 — Stage 2 업그레이드
- [ ] (#4) PDF/CSV 다운로드 — 백엔드 export + 프론트 버튼
- [ ] (#6) DB(SQLite/Postgres) + 24h 스케줄러 — 스크랩 결과 저장
- [ ] (#7) 팀에 `RawSignal` 계약 공유 → 브랜치 어댑터 통합
- [ ] (#8) Layer 2 스키마에 투자자/펀딩히스토리 등 필드 추가
- [ ] (#9) 외부 뉴스 데이터셋으로 합성 생성 파이프라인
