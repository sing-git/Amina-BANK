# Postgres 연동 가이드 (AMINA 백엔드)

> 목표: 스크래퍼가 모은 데이터를 DB에 저장하고(24h마다 갱신), 파이프라인이 거기서 읽기.
> 평가자 요구 "DB에 주기적으로 저장"을 충족하는 구조.

> ⚠️ **아래 TypeScript / SQL 코드는 터미널에 그대로 붙여넣지 마세요.**
> `import ...`, `export const ...` 같은 줄은 **파일에 넣는 코드**이지 셸 명령이 아닙니다.
> 터미널에 붙이면 `zsh: parse error near '}'` 같은 에러가 납니다. (셸엔 `npm`, `psql` 같은
> 명령만 입력)

---

## 0. 사전: Postgres 설치 & 실행 (셸에서)

```bash
# Mac (Homebrew)
brew install postgresql@16
brew services start postgresql@16

# DB 생성
createdb amina
```

설치 확인:
```bash
psql amina -c "SELECT version();"
```

---

## 1. 패키지 설치 (셸에서) — 이미 완료됨

```bash
cd backend
npm install pg
npm install -D @types/pg
```
(package.json에 `pg`, `@types/pg` 이미 추가돼 있음 ✓)

---

## 2. 연결 문자열 — `backend/.env`에 한 줄 추가

`.env` **파일**에 적는 값입니다 (터미널 명령 아님):

```
DATABASE_URL=postgresql://user:password@localhost:5432/amina
```

이 한 줄의 뜻을 분해하면:

```
postgresql://  user  :  password  @  localhost : 5432 / amina
   │            │         │           │          │       │
 프로토콜      DB유저   비밀번호     호스트       포트   DB이름
```

- **user / password**: Postgres 사용자 (Mac brew 기본은 보통 본인 맥 사용자명, 비번 없음)
- **localhost**: DB가 내 컴퓨터에서 돌면 그대로 `localhost`
- **5432**: Postgres 기본 포트
- **amina**: 위에서 `createdb`로 만든 DB 이름

Mac brew 기본 설정이면 보통 이렇게 됩니다 (유저=맥 사용자명, 비번 없음):
```
DATABASE_URL=postgresql://seungjupaek@localhost:5432/amina
```

---

## 3. 연결 풀 — `backend/src/db.ts` **파일**에 넣는 코드

이건 **파일에 저장하는 코드**입니다. 터미널에 붙여넣지 마세요.

```ts
import { Pool } from "pg";

// connectionString은 .env의 DATABASE_URL을 읽어옴
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 연결 확인용 헬퍼
export async function pingDb(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
```

---

## 4. 테이블 만들기 — SQL (셸에서 psql로 실행)

`backend/schema.sql` **파일**로 저장한 뒤, 셸에서 한 번 실행:

```sql
-- backend/schema.sql
CREATE TABLE IF NOT EXISTS signals (
  id           SERIAL PRIMARY KEY,
  client_id    TEXT NOT NULL,
  category     TEXT NOT NULL,
  source_type  TEXT NOT NULL,
  source_url   TEXT,
  raw_text     TEXT,
  detected_at  TIMESTAMPTZ NOT NULL,
  fetched_at   TIMESTAMPTZ DEFAULT now()   -- 24h 갱신 추적용
);

CREATE TABLE IF NOT EXISTS kyc_baselines (
  client_id  TEXT PRIMARY KEY,
  data       JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS decisions (
  id         SERIAL PRIMARY KEY,
  client_id  TEXT,
  actor      TEXT,
  action     TEXT,
  detail     TEXT,
  ts         TIMESTAMPTZ DEFAULT now()
);
```

실행 (셸에서):
```bash
psql amina -f backend/schema.sql
```

---

## 5. 저장 / 읽기 — `db.ts`에 함수로

```ts
import { pool } from "./db.js";
import type { RawSignal } from "./types.js";

// 스크래퍼가 모은 신호를 저장
export async function saveSignal(s: RawSignal): Promise<void> {
  await pool.query(
    `INSERT INTO signals (client_id, category, source_type, source_url, raw_text, detected_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [s.clientId, s.category, s.sourceType, s.sourceUrl ?? null, s.rawText ?? null, s.detectedAt],
  );
}

// 파이프라인이 한 고객의 신호를 읽음
export async function loadSignals(clientId: string): Promise<RawSignal[]> {
  const { rows } = await pool.query(
    `SELECT * FROM signals WHERE client_id = $1 ORDER BY detected_at DESC`,
    [clientId],
  );
  return rows.map((r) => ({
    signalId: String(r.id),
    clientId: r.client_id,
    category: r.category,
    detectedAt: r.detected_at.toISOString(),
    sourceType: r.source_type,
    sourceUrl: r.source_url ?? undefined,
    rawText: r.raw_text ?? undefined,
  }));
}
```

> `$1, $2 ...` = SQL 인젝션 방지용 파라미터 바인딩. 절대 문자열 이어붙이기로 쿼리 만들지 말 것.

---

## 6. 24h 갱신 흐름 — 구현됨, 테스트 가능

```
scheduler (INGEST_INTERVAL_MS, 기본 24h)
  → ingestToDb(): kycAdapter + newsAdapter 로 어댑터 읽기
  → saveBaseline() + saveSignal() 로 DB 기록 (signals 전체 갱신, fetched_at=now())

대시보드/파이프라인
  → loadSignals(clientId) 로 DB SELECT → runPipeline()
```

### 테스트 (짧은 간격으로 24h 흐름 확인)

```bash
cd backend
# 0) Postgres 실행 + DATABASE_URL .env에 설정 (위 2~3절)
npm run db:init                       # 테이블 생성

# 1) 한 번 적재
npm run db:ingest
#   → "Ingested 10 baselines and N signals into Postgres."

# 2) DB에 들어갔나 확인
npm run db:status
#   → signals: N rows, latest fetch <시각>
#     kyc_baselines: 10 rows, latest update <시각>

# 3) 주기 갱신 테스트 (24h 대신 10초 간격으로)
INGEST_INTERVAL_MS=10000 npm run scheduler
#   → 즉시 1회 + 10초마다 재적재. 다른 터미널에서 npm run db:status 로
#     latest fetch 시각이 갱신되는지 확인. Ctrl+C로 중단.
```

> 실서비스에선 `INGEST_INTERVAL_MS`를 비우면 24h(86,400,000ms)로 돌아갑니다.
> pgAdmin Query Tool에서 `SELECT count(*), max(fetched_at) FROM signals;` 로도 확인 가능.

⚠️ 지금은 스크래퍼가 만든 **JSON 파일**을 어댑터가 읽어 DB에 넣습니다. 스크래퍼(Giulio/Alice/Kiara)가
**직접 DB에 쓰게** 바꾸려면 각 Python에서 `psycopg2`로 `INSERT` 하면 됩니다 (다음 단계).

---

## 자주 나는 에러

| 증상 | 원인 | 해결 |
|---|---|---|
| `zsh: parse error near '}'` | TS/SQL 코드를 **터미널에 붙여넣음** | 코드는 **파일에**, 터미널엔 `npm`/`psql` 명령만 |
| `ECONNREFUSED ... 5432` | Postgres 안 돌아감 | `brew services start postgresql@16` |
| `database "amina" does not exist` | DB 안 만듦 | `createdb amina` |
| `password authentication failed` | DATABASE_URL의 user/password 틀림 | brew 기본은 보통 맥 사용자명, 비번 없음 |
