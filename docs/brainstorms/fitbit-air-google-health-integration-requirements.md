---
date: 2026-07-10
topic: fitbit-air-google-health-integration
---

# Fitbit Air (Google Health API) 연동

## Summary

Fitbit Air 데이터를 신규 **Google Health API(Google OAuth 2.0)** 로 Cistory에 연동한다. 기존 Withings 연동 골격을 재사용해 OAuth·암호화 토큰·크론 증분 동기화를 붙이고, intraday 포함 전 데이터를 손실 없이 저장(표출은 큐레이션)하며, 1단계로 새 최상위 `/health` 페이지에 일별 수면·활동·심박·산소 추세를 보여주는 기록·조회 대시보드를 제공한다.

---

## Problem Frame

사용자는 Fitbit Air(화면 없는 트래커, 2026-05 출시)를 구매했다. 이 기기는 24시간 심박수, HRV, SpO2, 수면 단계, 호흡수, 피부 온도, readiness, VO2 max, 활동량 등 풍부한 건강 데이터를 만들지만, 화면이 없어 모든 데이터가 별도의 **Google Health 앱**에만 갇혀 있다. Cistory는 커밋·위치·코딩·지출·자산을 한곳에 모아 "삶의 신호를 엮는" 개인 라이프로그인데, 건강이라는 큰 축만 이 앱 밖에 사일로로 남아 있다.

더구나 타이밍이 민감하다. 기존 Fitbit Web API는 2026-09에 종료되고 신규 Google Health API가 2026-05 GA로 대체되는 이행기이며(오늘 2026-07-10은 그 사이), 신규 API는 GA 2개월 차라 스키마가 아직 움직일 수 있다. 지금 잘못된(죽어가는) 경로로 붙으면 두 달 뒤 다시 짜야 한다. 또한 어떤 건강 데이터를 나중에 무엇과 상관지을지 아직 정해지지 않아, 좁게 저장하면 나중에 과거 데이터를 재백필해야 하는 비용이 생긴다.

---

## Actors

- A1. 사용자(본인): 설정에서 연동/해제하고, `/health`에서 건강 데이터를 조회한다.
- A2. 크론 워커: 전용 cron 컨테이너에서 주기적 증분 동기화와 최초 백필을 수행한다.
- A3. Google Health API: 외부 데이터 소스. 서버사이드 REST + Google OAuth 2.0.

---

## Key Flows

- F1. Fitbit(Google Health) 연동
  - **Trigger:** 사용자가 설정에서 "연동"을 시작
  - **Actors:** A1, A3
  - **Steps:** Google OAuth 동의 → 콜백에서 인가 코드 교환 → 토큰 암호화 저장 → 최초 백필 트리거
  - **Outcome:** 연동 상태가 active가 되고 과거 데이터 백필이 시작된다
  - **Covered by:** R1, R2, R3, R6

- F2. 주기적 동기화
  - **Trigger:** 크론 스케줄
  - **Actors:** A2, A3
  - **Steps:** active 연동 조회 → 토큰 유효성 확인/갱신 → watermark 이후 증분 fetch(요약 + intraday) → upsert 저장 → watermark·마지막 동기화 시각 갱신
  - **Outcome:** 최신 데이터가 저장되어 `/health` 대시보드와 데이터 사용량에 반영된다
  - **Covered by:** R3, R4, R5, R6, R7, R10

---

## Requirements

**연동 및 인증**
- R1. 사용자가 설정 화면에서 Fitbit(Google Health) 연동을 시작하고 해제할 수 있다. 연동 해제는 이후 동기화를 멈추되 이미 저장된 데이터는 보존하며(기존 GitHub·위치·포트폴리오 연동과 동일), 이후 `/health`는 마지막 동기화 데이터에 '연동 안 됨' 배너를 붙여 계속 표시한다.
- R2. 인증은 신규 Google Health API의 Google OAuth 2.0만 사용한다. 레거시 Fitbit 인증/Web API는 사용하지 않는다.
- R3. 액세스·리프레시 토큰은 암호화 저장하고 만료 시 자동 갱신하며, 갱신이 확정적으로 실패(권한 취소 등)하면 "재연동 필요" 상태로 표시해 설정 UI가 재연동을 안내한다.

**데이터 수집·저장**
- R4. 4개 지표군(수면 / 활동량 / 심혈관 / 산소·호흡·체온)의 일 단위 요약을 동기화·저장한다.
- R5. Google Health API에서 받을 수 있는 데이터는 intraday(초·분 단위 원시 시계열)를 포함해 전부 저장한다. 표출 여부와 무관하게 원시 응답을 손실 없이 보관한다.
- R6. 동기화는 증분(watermark) 방식이며 재실행이 안전(idempotent, upsert)해야 한다. 최초에는 계정에서 받을 수 있는 과거 데이터를 백필한다.
- R7. 동기화는 백그라운드 크론에서 주기적으로 실행된다(웹 요청 경로가 아니라 전용 cron 워크로드).

**표출 (/health 대시보드)**
- R8. 새 최상위 페이지 `/health`에 최근 일별 추세(큐레이션된 핵심 지표: 수면, 활동, 안정시 심박, SpO2 등)를 보여주는 기록·조회 대시보드를 제공한다.
- R9. 대시보드는 표출 지표를 큐레이션한다. 저장된 전체 데이터의 부분집합만 보여줘도 되며, 수집한 모든 데이터를 표출할 의무는 없다.
- R12. `/health`는 데이터 상태를 구분해 표시한다: (a) 연동 직후 백필 진행 중이면 '기록 불러오는 중', (b) 연결됐으나 아직 표시 범위에 저장 요약이 없으면 '데이터 없음' 빈 상태 — 둘 다 일반 로딩 스피너와 구분한다.

**운영·모니터링**
- R10. Fitbit/Health 관련 테이블의 행 수·용량이 기존 설정의 데이터 사용량 화면에 집계되어 저장 용량 추이를 모니터링할 수 있다.
- R11. Google OAuth 자격증명은 `.env`(기존 `WITHINGS_*` 방식)로 관리하고, `client_secret_*.json`은 `.gitignore`에 등록해 커밋에서 제외한다. **이 파일은 이미 public repo 작업 트리에 노출됐으므로, 착수 전 즉시: (1) `.gitignore` 패턴 추가, (2) 값을 `.env`로 이동, (3) 작업 트리에서 파일 삭제, (4) Google Cloud에서 client secret 로테이션.**
- R13. 원시 건강 응답 본문(intraday 포함)은 로그 라인·Sentry `extra`/breadcrumb·예외 페이로드에 절대 포함하지 않는다. 스키마 디버깅 로깅도 지표 값은 생략/마스킹하고, 기존 Withings 어댑터처럼 path·status·건수만 남긴다.

---

## Acceptance Examples

- AE1. **Covers R3.** 저장된 액세스 토큰이 만료된 상태에서 크론 동기화가 실행되면, 자동으로 리프레시해 동기화를 이어간다.
- AE2. **Covers R3.** 리프레시가 권한 취소 등으로 확정 실패하면, 다음 동기화에서 연동 상태가 "재연동 필요"로 바뀌고 설정 UI가 재연동을 안내한다(전송 오류·5xx 같은 일시 오류로는 상태를 바꾸지 않는다).
- AE3. **Covers R5, R6.** 동일 날짜 데이터를 다시 동기화해도 중복 없이 upsert되어 행이 늘지 않는다.
- AE4. **Covers R4, R5.** 특정 지표에서 intraday 스코프·데이터가 제공되지 않으면, 해당 지표만 건너뛰고 나머지는 정상 저장된다(부분 실패가 전체 동기화를 막지 않는다).
- AE5. **Covers F1, R1.** OAuth 동의를 거부하거나 코드 교환이 실패하면, 설정 UI는 '연동 안 됨' 상태를 유지하고 인라인 오류를 표시하며 연결 레코드를 만들지 않는다(전송 오류·5xx 같은 일시 오류로 상태를 바꾸지 않는다).
- AE6. **Covers R12, R8.** 특정 날짜·지표에 저장된 요약 행이 없으면, 해당 지표 추세에 0 값이 아닌 시각적으로 구분되는 '데이터 없음' 갭으로 표시한다.

---

## Success Criteria

- 연동 후 `/health`에서 최근 며칠치 수면·활동·안정시 심박·SpO2 일별 추세를 볼 수 있다(사용자 성과).
- 설정의 데이터 사용량 화면에서 Fitbit/Health 테이블 용량이 집계되어 증가 추이를 확인할 수 있다.
- ce-plan이 스키마·엔드포인트·동기화 구조를 설계할 때, 무엇을 저장/표출할지·UI를 어디 둘지·어떤 패턴을 재사용할지 재발명 없이 시작할 수 있다(핸드오프 품질).

---

## Scope Boundaries

- 레거시 Fitbit Web API/인증 사용 (2026-09 종료 예정 경로)
- 2단계: Withings 체성분과 합친 리포트 통합 건강 스토리
- 3단계: 수면·readiness vs 커밋/코딩, 활동 vs 위치 등 상관분석/인사이트
- intraday 샘플링/다운샘플링/롤업 최적화 (용량 추이를 보고 나중에 판단)
- 실시간 웹훅 수신 (지금은 크론 폴링)
- 다중 사용자 공개 + Google 앱 심사/보안(CASA) 평가

---

## Key Decisions

- 신규 Google Health API + Google OAuth 2.0 채택: 레거시 Fitbit Web API가 2026-09 종료 예정이라 신규 통합은 처음부터 신규 API로 붙인다. 서버사이드 REST + Google OAuth라 크론 백엔드에 적합하고, 이미 만들어 둔 웹 OAuth 클라이언트(`cistory-fitbit-track`)가 정확히 이 방식이다.
- intraday 포함 전 데이터 저장: 향후 무엇과 상관지을지 미정이라 재백필을 피하려 넓게 저장한다. 표출은 큐레이션하고, 용량은 데이터 사용량으로 모니터링하다 커지면 나중에 샘플링/롤업한다(심박 원시값은 행 수는 많아도 바이트는 작다).
- Withings 연동 골격 **부분** 재사용: OAuth 인증/콜백·암호화 토큰 저장·advisory-lock 토큰 갱신·크론 훅·설정 UI는 그대로 전용 가능. 단, **증분 watermark·백필 엔진은 신규 작업**이다 — Withings는 모든 그룹을 단일 트랜잭션에서 단일 정수 watermark로 upsert하는데(저빈도 체성분용), intraday 고빈도·이종 granularity(수면·HR·SpO2) 시계열엔 부적합하다. 대신 KIS의 재개형 watermark(`executionsBackfilledFrom`)·청크 커밋·지표별 watermark 패턴을 따른다.
- 새 최상위 `/health` 페이지: 데이터가 풍부해 portfolio처럼 전용 도메인 페이지가 적합하다. 2단계는 report, 3단계는 insights를 재사용한다.
- 실질 단일 사용자(테스트 모드): 건강 스코프가 Restricted라 프로덕션 공개엔 Google 심사가 필요하다. 본인만 OAuth 테스트 유저로 연결한다. 단, OAuth 앱이 'Testing' 상태면 Restricted 스코프 refresh 토큰이 ~7일 만에 만료될 수 있어 R3의 무인 자동 갱신이 주기적으로 깨질 수 있다 — 이 토큰 수명은 빌드 전 검증 대상이며(Outstanding Questions), 결과에 따라 (a) 앱 심사로 Production 승격 또는 (b) 주기적 재연동을 정상 동작으로 수용 중 하나를 택한다.

---

## Dependencies / Assumptions

- Google Cloud 프로젝트(`cistory-fitbit-track`)와 웹 OAuth 클라이언트가 이미 생성됨. OAuth 동의 화면에 본인 계정이 테스트 유저로 등록돼 있어야 한다.
- **[미검증 전제 — 빌드 전 게이트]** Google Health API가 서버사이드 REST + Google OAuth 2.0로 제공된다는 전제는 웹 리서치 수준이며 아직 라이브 검증 전이다. 만약 온디바이스 Health Connect였다면 크론+Withings 골격 전체가 무효가 되므로, 아래 'Resolve Before Planning'의 라이브 스파이크로 반드시 확정한다. GA 2개월 차라 엔드포인트·스코프·스키마가 변동될 수 있다.
- 토큰 암호화용 crypto 유틸(`src/lib/crypto.ts`, AES-GCM)이 이미 존재하며 그대로 재사용한다.
- 크론 워크로드가 전용 컨테이너로 분리돼 있어(웹 컨테이너는 `DISABLE_CRON=true`), 동기화가 웹 요청을 막지 않는다.

---

## Outstanding Questions

### Resolve Before Planning (빌드 착수 전 라이브 검증 게이트)

빌드 노력 투입 전, 본인 테스트 계정으로 라이브 스파이크 1회를 수행해 아래를 한 번에 확정한다. 하나라도 실패하면 1단계 전제가 무효이므로 대체안(작동하는 스코프 부분집합 또는 중단)을 먼저 정한다.

- [Affects R2, R7][Needs research] Google Health API가 서버 컨텍스트에서 실제 REST로 응답하는가(온디바이스 Health Connect가 아님) — base URL·엔드포인트·스코프 문자열·응답 스키마 확인.
- [Affects R1][Needs research] Restricted 스코프가 OAuth 'Testing' 모드(본인 테스트 유저)에서 앱 심사 없이 데이터를 반환하는가, '미확인 앱' 경고 수준은?
- [Affects R3][Needs research] 'Testing' 상태에서 Restricted 스코프 refresh 토큰 수명(≈7일?) — R3 무인 갱신 모델이 이를 견디는가.
- [Affects R4][Needs research] 기기 고유 지표(readiness·VO2max·HRV·피부온도)가 실제로 API에 노출되는가 — 노출 지표를 열거하고 1단계가 성립하는 최소 지표 세트를 정의한다.

### Deferred to Planning

- [Affects R5][Needs research] intraday 데이터가 별도 스코프를 요구하는지, 백필 보존기한 제약이 있는지 확인한다. intraday AE3 멱등성의 자연 유니크 키(userId+지표+표본시각 등)와 백필 볼륨 기준치도 함께.
- [Affects R6, R7][Technical] 동기화 주기와 최초 백필 깊이를 결정한다(24h치 intraday를 동기 처리하면 이벤트 루프 블로킹 우려 — 청크/비동기 고려).
- [Affects R8][Technical] 표출할 큐레이션 지표의 최종 세트와 차트 구성, `/health`의 last-synced 표시를 정한다.
- [Affects R10][Technical] 데이터 사용량 집계는 신규 배선이 필요하다(기존 Withings 테이블도 현재 `TABLE_DEFS`에 미등록). 새 테이블마다 추정기가 필터하는 `user_id` 컬럼이 필요하다.
- [Affects R1][Technical] 연동 해제 시 로컬 토큰 삭제 외에 Google 토큰 revocation 엔드포인트도 호출할지 결정한다.
- [Affects R8][Technical] `/health`는 페이지 경로로 안전하나, 건강 데이터 API 라우트를 `/api/health`에 두지 말 것 — Jenkins 배포 헬스체크 경로와 충돌한다.

## Deferred / Open Questions

### From 2026-07-10 review

- [#3 — R5 / Key Decisions] intraday '구조화' 저장이 1단계엔 과잉일 수 있다: 무손실 원시 응답 보관(Withings `rawMeasures` 선례)만으로 재백필 회피 목적은 달성되며, 구조화된 intraday 시계열 스키마는 실제 소비자(3단계 상관분석)가 생길 때 스코프하는 편이 나을 수 있다. 브레인스토밍에서 '전부 저장 후 나중 샘플링'으로 결정했으므로, 계획 단계에서 이 비용/이득을 한 번 더 확인한다. (product-lens, scope-guardian)
- [#8 — Problem Frame] '왜 지금' 정당화: 실제 선택지는 '레거시 vs 신규'가 아니라 '움직이는 스키마에 지금 vs 안정화 후'이고, R6 백필이 대기 시 데이터 공백을 이미 방어한다. 착수 근거를 데이터 손실이 아닌 다른 이유(학습 가치·백필 지평 한계 등)로 재정리하는 것을 고려한다. (adversarial)
