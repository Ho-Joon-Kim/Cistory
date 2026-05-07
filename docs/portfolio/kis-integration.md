# KIS (한국투자증권) OpenAPI 통합 설계 문서

> 작성: 2026-05-07
> 목적: Cistory에 한국투자증권 계좌(위탁 / 중개형 ISA / IRP / 개인연금)의 보유 종목·평가금액·비중을 자동 적재하기 위한 리서치 결과와 실행 계획을 한 문서로 정리.

---

## 1. 목적과 동기

Cistory는 GitHub 커밋, OwnTracks 위치, WakaTime 코딩 활동, Toss 거래내역을 자동 수집·통합하는 라이프 로깅 앱이다. 여기에 **금융 자산 스냅샷**을 추가하여:

- 일자별 보유 종목과 비중을 자동으로 시계열로 적재
- 월간/연간 리포트에 자산 변동을 다른 지표(코딩 활동, 여행 등)와 함께 보여줌
- 계좌별(위탁 / ISA / IRP / 개인연금) 통합 뷰 제공

**스코프:** 조회 전용. 자동 매매는 의도적으로 제외 (ISA 절세 룰, IRP 매수 금지 종목 등 사고 위험).

---

## 2. 핵심 결론 (TL;DR)

| 계좌 종류 | OpenAPI 조회 가능? | 비고 |
|---|---|---|
| 위탁 (`-01`) | ✅ | `inquire-balance` (`TTTC8434R`) |
| **중개형 ISA** (`-01`) | ✅ | **위탁 인프라 위에 올라가 있어 동일 TR로 조회됨** |
| 신탁형/일임형 ISA | ❌ | 별도 신탁업 채널, OpenAPI 미지원 |
| 퇴직연금 IRP (`-29`) | ✅ (조회) | 전용 퇴직연금 TR, 매매는 비추 |
| 개인연금 (`-22`) | ✅ (조회) | IRP와 동일 패턴 |
| 해외주식 | ✅ | `/uapi/overseas-stock/v1/trading/inquire-balance` (`TTTS3012R`) |

→ **사용자의 모든 KIS 계좌(중개형 ISA 포함)를 단일 KIS OpenAPI 어댑터로 통합 가능.** CODEF 같은 외부 마이데이터 SaaS 도입 불필요.

---

## 3. KIS OpenAPI 개요

### 3.1 인증 — OAuth 2.0 client_credentials

1. KIS Developers (`apiportal.koreainvestment.com`) 가입
2. 사용 신청 시 **본인 계좌번호 등록** (계좌별로 키쌍 발급)
3. `APP_KEY`, `APP_SECRET` 발급
4. `POST /oauth2/tokenP` (`grant_type=client_credentials` + appkey + appsecret) → **Access Token** 획득
5. 모든 API 호출에 다음 헤더 동봉:
   - `authorization: Bearer {token}`
   - `appkey`, `appsecret`
   - `tr_id` (거래코드)
   - `custtype: P` (개인)
6. **토큰 발급은 1분당 1회** 제한 → 캐싱 필수 (보통 24h 유효)

### 3.2 환경

| 환경 | Base URL |
|---|---|
| 실전 | `https://openapi.koreainvestment.com:9443` |
| 모의 | `https://openapivts.koreainvestment.com:29443` |

모의투자 트랙은 호출 한도가 매우 낮아 부하 테스트엔 부적합. 운영은 실전 직접 사용.

### 3.3 호출 한도

- 실전: 일반적으로 초당 20 TPS 가이드 (계정당)
- Cistory 용도(일 1회 스냅샷)에는 충분히 여유

### 3.4 계좌 유형 코드 (`ACNT_PRDT_CD`)

| 코드 | 종류 |
|---|---|
| `01` | 종합(위탁) — 일반 주식, **중개형 ISA 포함** |
| `03` | 국내선물옵션 |
| `08` | 해외선물옵션 |
| `22` | 개인연금(연금저축) |
| `29` | 퇴직연금(IRP/DC) |

> ⚠️ **중개형 ISA는 `01`로 부여된다.** 신탁형/일임형 ISA는 `30`번대 별도 코드이며 OpenAPI 미지원.

---

## 4. 사용할 핵심 엔드포인트

### 4.1 국내주식 잔고 조회 (위탁 + 중개형 ISA)

```
GET /uapi/domestic-stock/v1/trading/inquire-balance
headers:
  authorization: Bearer {token}
  appkey, appsecret
  tr_id: TTTC8434R   (실전) / VTTC8434R (모의)
  custtype: P
query:
  CANO=12345678              # 계좌번호 앞 8자리
  ACNT_PRDT_CD=01            # 뒤 2자리
  AFHR_FLPR_YN=N             # 시간외단일가 포함 여부
  OFL_YN=                    # 공란
  INQR_DVSN=02               # 02 = 종목별
  UNPR_DVSN=01               # 01 = 기본
  FUND_STTL_ICLD_YN=N
  FNCG_AMT_AUTO_RDPT_YN=N
  PRCS_DVSN=00               # 00 = 전일매매 포함
  CTX_AREA_FK100=
  CTX_AREA_NK100=
```

**응답 구조:**
- `output1[]`: 종목별 보유 (`pdno`, `prdt_name`, `hldg_qty`, `pchs_avg_pric`, `evlu_amt`, `evlu_pfls_amt`, `evlu_pfls_rt`)
- `output2[]`: 계좌 합계 (`tot_evlu_amt`, `dnca_tot_amt`, `nass_amt`, ...)
- 페이지네이션: 100개 초과 시 `CTX_AREA_FK100/NK100` 으로 이어붙임

**비중 계산:**
```
weight = output1[i].evlu_amt / output2[0].tot_evlu_amt
```

### 4.2 해외주식 잔고 조회

```
GET /uapi/overseas-stock/v1/trading/inquire-balance
tr_id: TTTS3012R   (실전 미국)
```

통화별 evlu_amt 가 USD 등으로 들어옴 → 환율 환산 후 합산해야 정확한 비중.

### 4.3 퇴직연금/개인연금 잔고

전용 카테고리에 별도 엔드포인트 존재:
- 퇴직연금 잔고조회
- 퇴직연금 체결기준잔고
- 퇴직연금 예수금조회
- 퇴직연금 매수가능조회
- 퇴직연금 미체결내역

→ KIS Developers 포털의 `[국내주식] > 퇴직연금` 카테고리 참조. (실제 TR_ID는 키 발급 후 포털에서 확인)

### 4.4 일별 체결/주문 내역 (선택)

```
GET /uapi/domestic-stock/v1/trading/inquire-daily-ccld
tr_id: TTTC8001R
```

스냅샷 외에 매매 이벤트를 시계열로 적재하고 싶으면 추가.

---

## 5. Cistory 통합 설계

### 5.1 모듈/어댑터 구조

기존 패턴(`src/lib/adapters/{ai,vcs,geocoding,wakatime,overpass}/`) 그대로 따라감:

```
src/lib/adapters/kis/
  ├─ interface.ts          # KISAdapter 인터페이스
  ├─ kis.ts                # 실 구현 (토큰 캐시 + REST 호출)
  └─ types.ts              # 응답 타입

src/modules/portfolio/
  ├─ service.ts            # 스냅샷 적재 비즈니스 로직
  ├─ hooks.ts              # 클라이언트 훅
  └─ components/           # UI

src/app/api/portfolio/
  ├─ accounts/route.ts     # 계좌 CRUD
  ├─ snapshot/route.ts     # 수동 스냅샷 트리거
  └─ holdings/route.ts     # 시계열 조회
```

### 5.2 DB 스키마 (Drizzle)

```typescript
// 사용자가 등록한 KIS 계좌 + 자격증명
brokerage_accounts {
  id: uuid PK
  userId: uuid FK -> users.id
  label: text                          // "메인 ISA", "IRP" 등 사용자 라벨
  broker: text                         // 'kis' (확장 대비)
  cano: text                           // 계좌 앞 8자리
  acntPrdtCd: text                     // '01' / '22' / '29' 등
  accountType: text                    // 'general' | 'isa_brokerage' | 'irp' | 'pension'
  appKey: text encrypted               // 키 암호화 보관
  appSecret: text encrypted
  accessToken: text                    // 토큰 캐시
  accessTokenExpiresAt: timestamptz
  isActive: boolean default true
  createdAt, updatedAt
}

// 일별 스냅샷 (계좌 단위 합계)
holding_snapshots {
  id: uuid PK
  accountId: uuid FK -> brokerage_accounts.id
  takenAt: timestamptz                 // 스냅샷 시각
  totalEvalAmount: numeric             // 총 평가금액 (KRW 환산)
  deposit: numeric                     // 예수금
  totalPurchaseAmount: numeric
  totalPnl: numeric
  rawOutput2: jsonb                    // 원본 보존
  UNIQUE (accountId, date_trunc('day', takenAt))
}

// 종목별 포지션 (스냅샷에 1:N)
holding_positions {
  id: uuid PK
  snapshotId: uuid FK -> holding_snapshots.id
  ticker: text                         // pdno
  name: text                           // prdt_name
  quantity: numeric                    // hldg_qty
  avgPrice: numeric                    // pchs_avg_pric
  evalAmount: numeric                  // evlu_amt (KRW 환산)
  pnl: numeric
  pnlRate: numeric
  weight: numeric                      // 0..1
  currency: text                       // 'KRW' | 'USD' | ...
  market: text                         // 'KOSPI' | 'KOSDAQ' | 'NASDAQ' | ...
  rawData: jsonb
  INDEX (snapshotId)
  INDEX (ticker, snapshotId)
}
```

### 5.3 크론 통합

`src/lib/cron.ts`에 일별 스냅샷 잡 추가:
- 스케줄: `0 18 * * 1-5` (KST 18:00 평일, 장 종료 후)
- 모든 활성 `brokerage_accounts`를 순회하며 잔고 조회 후 적재
- 토큰은 계좌별 24h 캐시
- 실패 시 Sentry로 보고, 다음 실행에서 재시도

### 5.4 보안 취급

- `app_key`, `app_secret`은 **PostgreSQL 컬럼 암호화** 또는 환경 KMS 사용. 평문 저장 금지.
- 사용자 본인 키만 본인 계좌 조회용 → 키 누출 시 매수/매도까지 가능하므로 OwnTracks/WakaTime 키보다 더 민감
- 키 등록은 `/dashboard/portfolio/setup` 폼에서 본인이 입력 → 즉시 토큰 발급 테스트로 검증

### 5.5 단계적 롤아웃

1. **Phase 1 (이번 세션 목표):** ISA 계좌 1개로 raw API 호출 검증, 응답 구조 파악
2. **Phase 2:** KIS 어댑터 + DB 스키마 + 수동 스냅샷 API
3. **Phase 3:** 크론 자동화 + 시계열 차트 UI
4. **Phase 4:** 위탁/IRP/연금 추가, 해외주식 환산
5. **Phase 5:** 월간/연간 리포트에 자산 변동 섹션 통합

---

## 6. 검증/테스트 계획 (Phase 1)

### 6.1 환경 변수

`.env.local` 또는 임시 셸 export:
```bash
KIS_TEST_APP_KEY=...
KIS_TEST_APP_SECRET=...
KIS_TEST_CANO=12345678
KIS_TEST_ACNT_PRDT_CD=01
```

### 6.2 검증 스크립트

`scripts/kis-test.ts` (또는 일회성 ts 파일)에서:
1. `POST /oauth2/tokenP` 으로 access_token 발급
2. `inquire-balance` 호출, 전체 output1/output2 raw 출력
3. 종목별 비중 계산하여 표로 출력
4. 토큰 재사용 검증 (두 번째 호출은 캐시 사용)

성공 기준:
- ISA 계좌의 모든 보유 종목이 output1에 나타남
- output2의 `tot_evlu_amt` 가 한투 앱 표시값과 일치
- 비중 합계 ≈ 1.0

### 6.3 알려진 함정

- ISA에선 매수 금지 종목(레버리지/인버스 ETF) 매수 시도 시 별도 에러 → 조회만 할 거라 무관
- 페이지네이션: 종목 수 ≤100 이면 한 번에 옴. 그 이상이면 next page key 처리 필요
- 응답 필드는 모두 **string**으로 옴 (숫자도). 파싱 시 `Number()` 또는 `BigInt` 변환 필수
- 휴장일에 호출하면 전일 종가 기준 평가금액 반환

---

## 7. 실측 검증 결과 (2026-05-07)

### 7.1 검증 환경

- 실전 트랙 키 1쌍으로 `87654321-22` (개인연금) 조회 성공
- 토큰 발급 → `inquire-balance` (`TTTC8434R`) 호출 흐름 작동 확인
- 토큰 expires_in=86400 (24h), `expires_at` 절대시각이 응답에 함께 옴

### 7.2 확정된 실측 사실

1. **`ACNT_PRDT_CD=22` 개인연금이 `TTTC8434R` (국내주식 잔고) TR로 그대로 조회됨.** 별도 퇴직연금 전용 TR 없이도 잔고/평가금/종목별 보유 다 받아짐. → §4.3에 적었던 "전용 TR 사용" 가정은 IRP(`29`)에 한정될 수 있음, 연금(`22`)은 일반 TR로 충분.
2. **키-계좌 인가 실패는 3단계 에러로 분리됨** — 어댑터에서 분기 처리에 사용:
   - `OPSQ2000 INVALID_CHECK_ACNO` → 게이트웨이 단계 (계좌가 키에 미등록)
   - `APBK1271 Not Found` → 백엔드 라우팅 단계 (계좌 인가는 OK, 상품코드 불일치)
   - `APAC0489 위탁계좌인 경우만 조회가능` → TR이 해당 계좌타입을 지원 안 함
3. **응답값은 전부 string** (`"126"`, `"24200"`) → 파싱 시 `Number()` 또는 `Decimal` 변환 필수
4. **페이지네이션 토큰 `ctx_area_fk100/nk100`은 공백 패딩된 고정폭 문자열** → 저장/비교 시 `trim()` 필수, 빈 nk100 = 다음 페이지 없음
5. **모의투자 호스트(`openapivts:29443`)는 실전 키로 토큰까진 발급되지만 실제 호출 시 `EGW02007 모의투자용 앱키가 아닙니다` 반환** → 토큰 발급 성공만으론 트랙 판별 불가, 본 호출에서 에러로 식별
6. **연속 호출 시 `EGW00201 초당 거래건수 초과`가 1초 간격에서도 가끔 발생** → 어댑터에 ≥1.2s sleep 또는 토큰버킷 도입 필요

### 7.3 응답 필드 매핑 (실측)

`output2[0]` 주요 필드:
| 필드 | 의미 | DB 매핑 |
|---|---|---|
| `tot_evlu_amt` | 총평가금액 | `holding_snapshots.totalEvalAmount` |
| `scts_evlu_amt` | 유가증권 평가금액 (예수금 제외) | (분모로 사용 — 비중 계산) |
| `dnca_tot_amt` | 예수금 총액 | `holding_snapshots.deposit` |
| `nass_amt` | 순자산금액 | (참고) |
| `pchs_amt_smtl_amt` | 매입금액 합계 | `holding_snapshots.totalPurchaseAmount` |
| `evlu_pfls_smtl_amt` | 평가손익 합계 | `holding_snapshots.totalPnl` |
| `bfdy_tot_asst_evlu_amt` | 전일 총자산 평가금액 | (전일 대비 증감 계산용) |
| `asst_icdc_amt` | 자산 증감액 | (참고) |

`output1[i]` 주요 필드:
| 필드 | 의미 | DB 매핑 |
|---|---|---|
| `pdno` | 종목코드 | `holding_positions.ticker` |
| `prdt_name` | 종목명 | `holding_positions.name` |
| `hldg_qty` | 보유수량 | `holding_positions.quantity` |
| `pchs_avg_pric` | 매입평균가 | `holding_positions.avgPrice` |
| `prpr` | 현재가 | (참고 — 시세는 별도 적재 안 해도 됨) |
| `evlu_amt` | 평가금액 | `holding_positions.evalAmount` |
| `evlu_pfls_amt` | 평가손익 | `holding_positions.pnl` |
| `evlu_pfls_rt` | 평가손익률 (%) | `holding_positions.pnlRate` |

**비중 계산**: `weight = evlu_amt / scts_evlu_amt` (예수금 제외 기준).
`tot_evlu_amt` 분모로 쓰면 예수금이 포함돼 비중 합이 1 미만이 됨 — 의도에 따라 선택.

### 7.4 발견된 불일치 / 정정 사항

- ~~본 문서 §3.4의 "중개형 ISA = `01`" 가정은 다음 ISA 키 발급 시 재확인 필요.~~ → **2026-05-07 검증 완료**: `12345678-01` 중개형 ISA가 `TTTC8434R` 그대로 동작, 위탁계좌와 동일한 응답 스키마.
- §4.3에서 "퇴직연금/개인연금은 전용 엔드포인트 필요"라고 적었으나, 실측상 **연금(22)·중개형 ISA(01)·일반 위탁(01)이 모두 동일한 `TTTC8434R` 으로 통합 조회 가능**. IRP(29)는 여전히 별도 검증 필요.

### 7.5 검증된 데이터 포인트 (참고용 스냅샷, 2026-05-07)

| 계좌 | CANO-PRDT | 보유 종목 수 | 총평가 (KRW) | 비중 합 | TR_ID |
|---|---|---:|---:|---:|---|
| 개인연금 | 87654321-22 | 5 | 14,890,865 | 100% | TTTC8434R |
| 중개형 ISA | 12345678-01 | 6 | 37,035,364 | 100% | TTTC8434R |

**핵심 결론**: KIS OpenAPI 어댑터는 **단일 구현으로 위탁/ISA/연금 모두 커버 가능**. 계좌별로 키쌍만 분리 발급받아 어댑터 인스턴스에 주입하면 됨.

## 8. 미해결/추후 결정

- [ ] 키 암호화 방식 결정: pgcrypto vs 앱단 KMS vs 단순 envelope encryption
- [ ] IRP(`29`) 전용 TR이 정말 필요한지 vs 일반 TR로 충분한지 실측
- [ ] 중개형 ISA의 실제 `ACNT_PRDT_CD` 값 실측 (다음 키 발급 시)
- [ ] 해외주식 환율 환산 소스 (한국은행 API? 기존 데이터?)
- [ ] 스냅샷 빈도: 일 1회로 충분한지 vs 시간 단위 (장 시간 동안 비중 변동 추적)
- [ ] UI에서 계좌별 색상 구분, 비중 도넛 차트 디자인
- [ ] 에러 매핑: `OPSQ2000`/`APBK1271`/`APAC0489`/`EGW02007`/`EGW00201` → 사용자 메시지 표준화

---

## 8. 참고 링크

- [KIS Developers 포털](https://apiportal.koreainvestment.com/)
- [공식 GitHub 샘플 — koreainvestment/open-trading-api](https://github.com/koreainvestment/open-trading-api)
- [Soju06/python-kis (가장 활발한 래퍼)](https://github.com/Soju06/python-kis)
- [KIS API 호출 유량 제한 분석](https://hky035.github.io/web/kis-api-throttling/)
- [한국투자증권 ISA 중개형 상품가이드](https://securities.koreainvestment.com/main/mall/isa/_static/TF02ef020000.jsp)
