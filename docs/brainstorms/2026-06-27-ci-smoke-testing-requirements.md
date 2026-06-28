---
date: 2026-06-27
topic: ci-smoke-testing
---

# CI 스모크/단정 테스트 도입 — 요구사항

## Summary

Cistory CI에 테스트 계층을 추가한다. 조용히 틀리면 아픈 순수 로직(금융 수익률·Toss 파싱·거리·detection 수학)엔 입력→기대출력 **진짜 단정** 유닛 테스트를, 전 API 라우트엔 "import하면 안 터진다" 얕은 스모크를, 크론 잡 본문엔 mock 기반 "안 터지고 핵심 서비스 부른다" 스모크를 건다. Jenkins 파이프라인을 게이팅한다. **녹색 빌드 = "라우트 모듈이 로드 가능하고, 순수 계산이 맞고, 크론 본문이 mock 하에서 안 터진다"** — 런타임 라우트 정확성(실제 요청 처리)과 크론의 프로덕션 화재는 커버하지 않는다(각각 L3·하트비트로 미룸).

---

## Problem Frame

혼자 쓰는 서비스라 깊은 테스트는 과하지만, 지금은 자동 검증이 사실상 **"컨테이너가 부팅되고 `/api/health`가 200"** 하나뿐이다(`Jenkinsfile`). 그래서 기능이 깨져도 알 방법이 없고, 실제로 세 가지가 반복해서 물었다:

1. **크론이 돌아야 하는데 조용히 멈춰** 며칠치 데이터가 안 쌓임.
2. **기능이 깨진 줄도 모르다가** 우연히 로그에서 에러를 발견.
3. **금융 수치(수익률·거래 파싱)가 틀려도** 눈으로 보고 위화감을 느끼는 것 말곤 검증할 길이 없음.

목표는 "이거 작동은 하고 트리거링은 됨" 수준 — 망가졌는지 아닌지를 머지 전에 자동으로 알아채는 안전망이지, 포괄적 정확성 검증이 아니다.

세 공포가 실제로 잡히는 위치:

| 공포 | 잡히는 곳 | 비고 |
|---|---|---|
| 1. 크론이 안 돎 | 부분만 (CI = 크론 *로직*) | 프로덕션에서 크론이 죽는 건 CI 원리상 못 잡음 → 하트비트(범위 밖) |
| 2. 깨진 줄 모름 | 라우트 import 스모크 + 크론 스모크 | import 크래시·깨진 의존성까지(런타임 500·핸들러 호출은 L3 미커버) |
| 3. 수치가 틀림 | 순수 로직 단정 유닛 | 가장 싸고 가장 확실하게 막히는 영역 |

---

## Key Decisions

- **크론 화재(firing) 감시는 CI 밖이다.** CI는 git push 시점에 한 번 도는 거라, 배포된 컨테이너에서 node-cron이 한참 뒤 조용히 멈추는 걸 원리상 못 잡는다. CI는 크론이 *부르는 로직*만 책임지고, 프로덕션 화재 감시(하트비트/데드맨 스위치)는 별건으로 미룬다.
- **깊이를 분리한다.** 조용히 틀리면 아픈 순수 계산엔 진짜 단정, 트리거링만 걱정인 표면엔 얕은 스모크. 모든 기능을 같은 깊이로 덮지 않는다.
- **CI에서 라이브 외부 호출·실제 DB 없이 전부 통과한다.** 라이브 GitHub/KIS/Anthropic/Kakao/Mapbox/Overpass 호출은 느리고 flaky하고 secret에 의존하므로 금지. 어댑터 mock + 순수 함수로만 돈다.
- **크론 본문 추출 리팩터를 수용한다.** 잡 본문이 export 안 된 private 함수라 테스트 불가 — 작은 추출 리팩터까지는 한다. 이미 데이터 유실 사고 이력이 있어 정당화된다. 단, 진짜 Postgres/PostGIS 통합 하네스는 만들지 않는다.

---

## Requirements

### 순수 로직 단정 (Layer 1)

- R1. 금융 수익률 계산(`src/modules/portfolio/returns.ts`의 `computeReturns`/`computeTWR`/`inferCashflows`/`computeXIRR`)에 알려진 입력 fixture에 대한 기대 출력 단정 테스트가 있다. 핵심 TWR/XIRR 케이스의 기대값은 현 구현 출력을 스냅샷하지 말고 **독립적으로 산출**(손계산 또는 스프레드시트 등 외부 레퍼런스)한다 — 출력 스냅샷은 "값이 바뀌었다"만 증명할 뿐 "맞았다"를 증명 못 해 공포 #3을 못 막는다. 부득이 현 출력에서 캡처한 케이스는 "회귀 전용"으로 명시 태깅한다.
- R2. Toss 알림 파서(`src/modules/transaction/parser.ts`의 `parseTossNotification`)에 패턴별(기본 출금/입금, 송금 수신, 결제, self-transfer) 입력→기대 출력 단정 테스트가 있다.
- R3. I/O·DB 없는 순수 함수에 한해 입력→기대 출력 단정 테스트가 있다. 거리 계산(`src/lib/geo.ts`의 `distanceM`)은 확정 대상. detection 쪽은 누적 상태·`getDb()` 의존 함수를 제외하고 자체 완결적인 수학 헬퍼(예: 속도→모드 임계 분류기가 이미 격리돼 있으면)로 한정한다 — 그 외는 L5 영역.

### 라우트 스모크 (Layer 2)

- R4. 모든 `src/app/api/**/route.ts`가 throw 없이 로드(import)됨을 검증한다. import-time 크래시·깨진 의존성·모듈 스코프 env 누락을 잡는다. 단, 기존 `next build`가 이미 더미 env로 라우트 모듈 스코프를 평가하므로(Dockerfile) R4의 고유 델타는 주로 "런타임엔 존재하지만 빌드 시엔 더미인 env(`KIS_ENCRYPTION_KEY` 등) 패리티" 검증이다 — R4 유지 vs 타깃 env-존재 체크로 축소는 Outstanding Questions.

### 크론 로직 스모크 (Layer 4)

- R5. 크론 잡 본문(`syncAllUsers`, `processYesterdayLocations`, `reparseTodayNotifications`)을 호출·테스트 가능한 형태로 추출한다.
- R6. 추출된 크론 잡을 mock된 DB/서비스로 호출했을 때 throw하지 않고, 기대한 핵심 서비스 호출이 일어남을 검증한다.
- R7. 고위험 플로우(금융 sync, Toss 인제스트 엔드포인트, AI 요약 트리거, 위치 처리)에 어댑터를 mock한 성공경로 테스트가 있다.

### CI 통합

- R8. 테스트가 Jenkins 파이프라인의 한 스테이지로 실행되며, 실패 시 빌드/배포를 막는다.
- R9. 전 테스트가 라이브 서드파티 API 호출이나 실제 DB 없이 통과한다.

---

## Acceptance Examples

- AE1. **Covers R4.** 라우트 모듈이 모듈 스코프에서 필수 env를 읽다가 없으면 throw → import 스모크가 잡는다. 반면 `getDb()`는 lazy라 import만으론 안 터지고 *호출* 시 터지므로, import 스모크 통과는 "로드 가능"까지만 보장한다(실행 정상성은 보장하지 않음).
- AE2. **Covers R1.** 고정된 snapshot/execution 세트에 대해 `computeReturns`가 **독립 산출한** 특정 TWR/XIRR 값을 반환한다 — 구현이 그 값에서 벗어나면 실패한다(정확성 오라클이지 단순 출력 스냅샷이 아님).
- AE3. **Covers R6.** mock된 의존성으로 `syncAllUsers`를 호출했을 때, 동기화 대상 유저가 0명이어도(또는 외부 호출이 mock으로 막혀도) throw 없이 완료되고 예상한 서비스 진입점이 호출된다.

---

## Scope Boundaries

### 나중에 (Deferred)

- 프로덕션 크론 하트비트/데드맨 스위치 — 공포 #1의 진짜 해결책이지만 CI가 아닌 런타임 모니터링 영역.
- HTTP/auth 실행 스모크 (Layer 3) — 빌드된 앱을 띄워 미인증 호출 → not-500/401 계약 확인. v1 이후.
- test Postgres/PostGIS 통합 테스트 (Layer 5) — SQL/PostGIS 자체가 반복해서 무는 경우에만.

### 이 작업의 정체성 밖 (Outside)

- 60개 라우트 전수 E2E.
- Better Auth OAuth 로그인 재현.
- 크론 스케줄 *타이밍* 테스트(실제 시각에 발화하는지).
- API 응답 스냅샷 떡칠.
- "제대로 유닛테스트 하려고" 하는 대규모 리팩터.
- CI에서의 라이브 서드파티 호출.

---

## Success Criteria

- 녹색 CI를 보고 "기능이 트리거되고 돈 계산이 맞다"를 신뢰할 수 있다.
- 금융 계산·파서 회귀가 머지 전에 잡힌다.
- 테스트 실행이 빠르고 flaky하지 않다(라이브 호출·외부 의존 0).

---

## Dependencies / Assumptions

- 테스트 러너를 devDependency로 추가할 수 있다(현재 `package.json`엔 테스트 스크립트 없음).
- 서비스가 대체로 `createXService(db, ...)` 팩토리 경계로 분리돼 있어 mock 주입이 가능하다. **예외: 위치 파이프라인**(anomaly-filter, visit-persister, track-persister, trip-detector, subway-discovery 등)은 `(userId, dateStr)`만 받고 `getDb()`를 내부 호출하며 `processYesterdayLocations`는 raw PostGIS SQL을 직접 실행한다 — 팩토리 db 주입이 불가하고, no-DB mock은 PostGIS 로직이 아니라 mock plumbing만 검증한다(접근 결정은 Outstanding Questions).
- 크론 잡 본문 추출에 리팩터가 필요하다(현재 `src/lib/cron.ts` 내 private 함수이며 `syncAllUsers`가 `getDb()`·서비스를 인라인 생성). 규모가 "작은 리팩터"인지는 플래닝 전 스파이크로 확인한다(Outstanding Questions).

---

## Outstanding Questions

### 플래닝에서 결정

- 테스트 러너 선택 (Codex는 vitest 제안; 미확정).
- 라우트 import 스모크 구현 방식 — glob으로 전 `route.ts` 동적 import vs 명시 목록.
- 401 미인증 계약을 *직접 핸들러 호출*로 v1에 포함할지(앱 부팅 없이 가능, L2/L3 경계가 모호함) vs L3로 미룰지.
- R3 순수 detection 헬퍼 후보 중 실제 단정 대상 확정(R3 스코프 규칙으로 stateful·`getDb()` 함수는 이미 제외; `distanceM`은 확정).
- 크론 본문 추출 형태 — 별도 export 함수 vs 주입 가능한 의존성 구조.
- 위치 파이프라인(R6·R7 위치 흐름) 테스트 접근 — `@/db` 모듈 레벨 mock으로 갈지 vs 위치 흐름을 L3/L5로 미룰지(팩토리 db 주입 불가).
- R4 유지 vs 타깃 env-존재 체크로 축소 — `next build` 대비 고유 델타가 런타임 env 패리티뿐이면 import 전수 스모크는 과할 수 있음.

### From 2026-06-27 review (deferred)

- 크론 본문 추출이 "작은 리팩터" 범위인지 플래닝 전 30분 스파이크로 확인 — `syncAllUsers`/`processYesterdayLocations`/`reparseTodayNotifications` 시그니처를 db·서비스 주입형으로 바꾸는 비용. (scope-guardian)
- 전부 mock한 크론 스모크(R6)의 단정 계약 정의 — 관측 가능한 부수효과 출력 vs 호출-인자 형태 계약 vs 호출 횟수 중 무엇을 단정할지. 동어반복(mock이 불렸나만 확인)도, 정확 호출순서 단정으로 인한 brittle도 회피. (adversarial)

---

## Sources / Research

- `src/lib/cron.ts` — 크론 잡 본문(private, 추출 대상)과 스케줄 등록.
- `src/modules/portfolio/returns.ts` — 순수 금융 계산(TWR/XIRR/cashflow).
- `src/modules/transaction/parser.ts` — 순수 Toss 파서.
- `src/lib/geo.ts` — 거리 계산(Haversine).
- `Jenkinsfile` — 현 CI(Checkout → Build → Migrate → Deploy → Health Check → Cleanup); 테스트 스테이지 추가 지점.
- Codex 자문 — 계층 우선순위(순수 유닛 > import 스모크 > HTTP 스모크 > 크론 스모크 > DB 통합)와 피할 안티패턴(전수 E2E, 라이브 호출, OAuth 재현, 스케줄 타이밍 테스트, 스냅샷 떡칠, 대규모 리팩터).
