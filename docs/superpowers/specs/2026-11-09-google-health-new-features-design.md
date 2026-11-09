# Google Health API 신규 기능 — 웹훅 · 신규 데이터 타입 · dataSourceFamily · ECG/IRN

날짜: 2026-11-09
대상: `src/lib/adapters/google-health/`, `src/modules/health/service.ts`, `src/modules/health/sessions.ts`,
신규 `src/app/api/fitbit/webhook/route.ts`, `src/lib/cron.ts`, `src/lib/sentry-scrub.ts`,
`src/app/api/fitbit/{authorize,callback}`, `/health` UI, 신규 마이그레이션 0045~

> 개인정보: 이 문서는 API **형태와 필드명**만 기록한다. 라이브 스파이크의 실제 측정값은 적지 않았고,
> 비교 수치는 비율로만 남겼다. 스파이크는 dev DB(`100.103.66.56`)에서 `SET default_transaction_read_only = on`으로
> 저장된 refresh token을 읽고, 메모리 안에서만 access token을 갱신해 GET/조회성 POST(`dailyRollUp`, `rollUp`)만 호출했다.
> DB 쓰기와 토큰 출력은 하지 않았다. 스크립트는 세션 스크래치패드에 있으며 저장소에는 커밋하지 않는다.

## 문제

[릴리스 노트](https://developers.google.com/health/release-notes)상 2026-04 ~ 2026-10 사이에 쓸 만한 기능 넷이 추가됐다.

1. **웹훅 구독**(`projects.subscribers` / `.subscriptions`, 2026-04-14 · 2026-05-26). 실패한 알림은 최대 7일 동안 재시도한다.
2. **데이터 타입**: daily-vo2-max, run-vo2-max, floors, total-calories, weight, body-fat, height, blood-glucose,
   core-body-temperature. `skin-temperature-sensors`는 v4beta에만 있다.
3. **`dataSourceFamily`**: `list`에서 쓸 수 있는 데이터 출처 필터(2026-10-14).
4. **electrocardiogram / irregular-rhythm-notification**: 새 스코프 `.ecg.readonly`·`.irn.readonly`가 필요하다(2026-05-26).

현재 sync는 CLAUDE.md의 "10분 폴링"보다 느리다. `syncAllUsers`는 10분마다 돌지만, `health.syncUser`는
`skipIfSyncedWithinMs: 24h`로 막혀 있어서 **정방향 sync는 하루에 한 번**만 실행된다(`src/lib/cron.ts`). 10분마다
도는 것은 백필뿐이다. 웹훅의 가치는 "폴링을 줄인다"보다 "하루 지연을 몇 분으로 줄인다"에 있다.

## 결정 요약 (확정 — 끝의 "확정된 결정" 참고)

| 항목 | 제안 | 이유 |
|---|---|---|
| 웹훅 수신 위치 | **web 컨테이너의 `/api/fitbit/webhook`은 검증하고 큐에 넣기만 한다** | Google은 즉시 `204`를 요구한다. Google API 호출과 집계는 web의 이벤트 루프를 막으므로 cron 컨테이너에서 처리한다(cron 분리 원칙) |
| 구독 방식 | **subscriber 1개, `AUTOMATIC` 정책** | 사용자별 구독 API 호출이 필요 없다. 동의한 타입과 설정한 타입의 교집합이 자동으로 구독된다 |
| 폴링 | **유지** (24h 게이트 + 백필 그대로) | 웹훅을 지원하지 않는 타입이 있다(spo2 · vo2-max · active-energy-burned · core-body-temperature · daily-vo2-max · ECG · IRN). 웹훅에는 백필이 없고, Health Connect 경유 데이터에도 알림이 오는지는 문서화되어 있지 않다 |
| dataSourceFamily | **저장 경로에는 적용하지 않는다.** 롤업 전용 메트릭과 검증 스크립트에만 쓴다 | 실측 결과 `google-wearables`는 밴드를 차지 않은 날을 버린다. 현재의 dominant-source 방식이 그런 날도 맞게 처리한다(§3) |
| 신규 타입 | **daily-vo2-max · run-vo2-max · total-calories · core-body-temperature · blood-glucose는 config만 추가**한다. weight/body-fat/height는 계속 제외한다 | §6에서 정한 "Withings가 체성분을 담당한다"는 결정을 유지한다. 대부분은 지금 비어 있지만 config 한 줄로 "연결됨, 데이터 없음" 상태가 된다 |
| ECG/IRN | **옵션 스코프로 추가 동의를 받는다.** 기본 연결 스코프에는 넣지 않는다 | Fitbit Air는 ECG 지원 기기가 아니다. 의료 등급 데이터라 보존과 표시 정책을 먼저 정해야 한다 |
| 선행 버그 수정 | **세션 sync를 시간 창 방식으로 전환한다** (§0) | 스파이크에서 exercise 히스토리 약 300건 누락과, 세션 필터가 사실은 동작한다는 점을 발견했다 |

---

## 조사 결과 A — 공식 문서

### A1. 웹훅 ([guide](https://developers.google.com/health/webhooks))

**구독자 등록 (프로젝트 단위, 1회)**
- `POST https://health.googleapis.com/v4/projects/{PROJECT_NUMBER}/subscribers?subscriberId={id}`
  - `{PROJECT_NUMBER}`에는 프로젝트 **번호**가 들어간다. 프로젝트 ID를 넣으면 400 또는 403이다. `subscriberId`는 `[a-z]([a-z0-9-]{2,34}[a-z0-9])` 형식이다.
  - OAuth 스코프는 **`https://www.googleapis.com/auth/cloud-platform`**, IAM 권한은 `health.subscribers.create`다.
    사용자 OAuth 토큰으로는 호출할 수 없다. 서비스 계정(역할: Google Health API Admin/Editor)이나
    gcloud ADC를 쓴다. 응답은 `Operation`이다.
  - body: `{ endpointUri, subscriberConfigs: [{ dataTypes: [kebab…], subscriptionCreatePolicy: AUTOMATIC|MANUAL }], endpointAuthorization: { secret } }`.
    `secret`은 Google이 매 요청의 `Authorization` 헤더에 그대로 넣어 보내는 값이다(`Bearer <token>` 등).
  - 그 밖의 메서드: `list` · `patch`(`updateMask`, `subscriberConfigs`는 병합이 아니라 전체 교체) · `delete`.
- **엔드포인트 검증**: create 시, 그리고 `endpointUri`나 `endpointAuthorization`을 patch할 때 동기적으로 실행된다.
  `User-Agent: Google-Health-API-Webhooks`, body는 `{"type":"verification"}`이다.
  인증 헤더가 있는 요청에는 **200/201**, 없는 요청에는 **401/403**을 돌려줘야 한다. 둘 중 하나라도 어긋나면
  `FAILED_PRECONDITION`으로 실패하고 subscriber는 저장되지 않는다. 따라서 **라우트를 먼저 배포해야 등록할 수 있다.**
- **요건**: HTTPS(TLS 1.2 이상)이고 공개적으로 접근 가능해야 한다. Pub/Sub은 쓰지 않고 직접 HTTPS POST로 받는다.

**구독**
- `AUTOMATIC`: Google이 사용자별 구독을 암묵적으로 만든다. 사용자가 동의한 타입과 config 타입의 교집합만
  알림이 오며, subscriber 생성 전에 동의한 사용자도 포함된다. **구독 이전 데이터는 백필되지 않는다.**
  동의를 철회하면 알림이 멈춘다. 이 구독은 개별로 조회하거나 삭제할 수 없다.
- `MANUAL`: `projects.subscribers.subscriptions` create/list/patch/delete로 관리한다.
  `{ dataTypes, user: "users/{healthUserId}" }` 형태로 사용자마다 만든다.

**알림 형식**
- POST 헤더는 `Authorization`(등록한 secret), `GOOGLE-HEALTH-API-SIGNATURE`(Base64), `Content-Type: application/json`이다.
- body는 **최대 99건을 담은 JSON 배열**이고, 사용자와 타입이 섞여 올 수 있다. 각 항목은 `data`에 다음을 담는다.
  `version`("1"), `clientProvidedSubscriptionName`(AUTOMATIC이면 `auto-<projectNumber>-<subscriberId>-WEBHOOK_DATA_TYPE_STEPS` 형식),
  `healthUserId`, `operation`(`UPSERT`|`DELETE`), `dataType`, `intervals[]`, 식별 가능한 레코드(sleep 등)에는 `recordId`.
- `intervals[]`에는 `civilDateTimeInterval`과 `civilIso8601TimeInterval`이 항상 들어 있다. `physicalTimeInterval`(UTC)은
  daily 롤업과 하루 종일 활동이면 **빠진다.**
- 알림에는 **건강 값이 없고 ID와 시간 구간만 있다.** 실제 데이터는 API를 다시 조회해 가져온다.
- `DELETE`는 사용자가 Fitbit 앱에서 지우거나 batchDelete할 때 온다. 동의 철회나 계정 삭제에는 오지 않는다.

**인증과 서명**
- `Authorization` 헤더를 등록한 secret과 비교하고, 다르면 401로 거부한다.
- `GOOGLE-HEALTH-API-SIGNATURE`는 원본 body 바이트에 대한 Tink `PublicKeySign`(ECDSA P-256 + SHA-256) 서명이다.
  공개 keyset: `https://www.gstatic.com/googlehealthapi/webhooks/webhooks_public_keyset.json`. 키는 30일마다 회전한다.
  - 실측한 keyset 형태: `{ primaryKeyId, key: [{ keyData: { typeUrl: "…tink.EcdsaPublicKey", value: <b64 proto>, keyMaterialType: "ASYMMETRIC_PUBLIC" }, status, keyId, outputPrefixType: "TINK" }] }`, 키 5개.
  - Node용 공식 Tink는 없으므로 직접 검증한다. 서명은 `0x01 ‖ keyId(4B BE) ‖ DER(r,s)`로 되어 있다. `keyId`로 키를 찾고,
    `EcdsaPublicKey` proto(field 3 = x, field 4 = y)를 최소 파서로 읽는다. 읽은 x, y로 JWK를 만들고
    `crypto.verify("sha256", rawBody, {key, dsaEncoding:"der"}, sig)`로 검증한다.
    keyset은 메모리에 캐시하고, 모르는 keyId가 오면 한 번 다시 받는다.

**재시도**
- 응답 `204 No Content`만 성공으로 본다. 그 외 응답이나 타임아웃이면 지수 백오프로 재시도하고 **최대 7일까지 보관**한 뒤 버린다.
  타임아웃 값과 순서 보장은 문서에 없다. 중복 전달이 가능하므로 처리는 멱등이어야 한다.
- 문서는 큐에 넣은 뒤 `reconcile`이나 `list`로 해당 구간을 다시 읽는 방식을 권장한다.

**지원 타입 (웹훅 표 기준)**
- activity_and_fitness: active-minutes, active-zone-minutes, activity-level, altitude, calories-in-heart-rate-zone, distance,
  exercise, floors, run-vo2-max, sedentary-period, steps, time-in-heart-rate-zone
- health_metrics_and_measurements: blood-glucose, body-fat, daily-heart-rate-variability, daily-heart-rate-zones,
  daily-oxygen-saturation, daily-respiratory-rate, daily-resting-heart-rate, daily-sleep-temperature-derivations, heart-rate,
  heart-rate-variability, height, respiratory-rate-sleep-summary, weight
- sleep: sleep
- **없음**: `oxygen-saturation`(intraday spo2), `vo2-max`, `active-energy-burned`, `daily-vo2-max`, `core-body-temperature`,
  ECG, IRN. `total-calories`는 2026-04 릴리스 노트에는 `totalCalories`로 나오지만 데이터 타입 표에는 "No"로 되어 있어 **불일치**한다. 실제 등록해서 확인해야 한다.

**사용자 매핑**: `GET /v4/users/me/identity`가 `{ name, legacyUserId, healthUserId }`를 돌려준다. 기존 세 스코프 중 하나만 있어도 된다.
매핑은 고정이므로 영구 캐시해도 된다.

**쿼터** ([rate-limits](https://developers.google.com/health/rate-limits)): 사용자당 300 req/min, 미검증 앱은 전체 250 QPS와
사용자 100명 상한, 프로젝트 전체는 120k/min이다. 웹훅 전달 자체의 쿼터는 문서에 없다. 단일 사용자 앱이라 어느 것도 문제가 되지 않는다.

### A2. 신규 데이터 타입 ([data-types](https://developers.google.com/health/data-types), [REST ref](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints))

| 타입 | 레코드 | 스코프 | 메서드 | 웹훅 | 값 필드 |
|---|---|---|---|---|---|
| `daily-vo2-max` | Daily | activity | list, reconcile | ✗ | `dailyVo2Max.vo2Max` number, `cardioFitnessLevel` enum, `estimated`, `vo2MaxCovariance` |
| `run-vo2-max` | Sample | activity | list, reconcile, rollUp, dailyRollUp | ✓ | `runVo2Max.runVo2Max` number |
| `floors` | Interval(1분) | activity | **reconcile, rollUp, dailyRollUp** (list 불가) | ✓ | rollup 필드 |
| `total-calories` | Interval(1분) | activity | **rollUp, dailyRollUp만** | ?(불일치) | rollup `totalCalories.kcalSum` |
| `weight` | Sample | metrics | list, get, reconcile, rollUp, dailyRollUp | ✓ | `weightGrams` number |
| `body-fat` | Sample | metrics | 위와 동일 | ✓ | `percentage` number |
| `height` | Sample | metrics | list, get, reconcile | ✓ | `heightMillimeters` **int64 문자열** |
| `blood-glucose` | Sample | metrics | list, get, reconcile, rollUp, dailyRollUp | ✓ | `bloodGlucoseMilligramsPerDeciliter` number + `measurementSource`/`mealType`/`measurementTiming`/`specimen` enum |
| `core-body-temperature` | Sample | metrics | list, get, reconcile, rollUp, dailyRollUp | ✗ | `temperatureCelsius` number + `measurementLocation` enum |
| `skin-temperature-sensors` | Sample | metrics | list (**v4beta**) | — | 분 단위 원시 센서값. Fitbit Edge, Pixel Watch 4/5 전용 |

### A3. dataSourceFamily ([filters](https://developers.google.com/health/filters#filter-by-data-source))

- AIP-160 `filter`와는 **별개 파라미터**다. `list`/`reconcile`은 쿼리 파라미터, `rollUp`/`dailyRollUp`은 JSON body 필드로 넘긴다.
- 값은 전체 리소스명 `users/me/dataSourceFamilies/<family>`여야 한다. 짧은 이름은 400이다.
  - `all-sources`(기본값), `google-wearables`(Google/Fitbit 트래커만), `google-sources`(1st-party 전체: 트래커, HC, 1st-party 앱의 수동 입력),
    `self-sources`(이 OAuth 클라이언트가 쓴 데이터).
- `list`의 `sleep`, `food`, `food-measurement-unit`은 400이다. sleep을 출처별로 거르려면 `reconcile`을 써야 한다.

### A4. ECG / IRN ([vitals](https://developers.google.com/health/data-types/vitals), [scopes](https://developers.google.com/health/scopes))

- 스코프는 `https://www.googleapis.com/auth/googlehealth.ecg.readonly`와 `…googlehealth.irn.readonly`다. 둘 다 읽기 전용이다.
- `electrocardiogram`(Session, list만 가능, 웹훅 ✗)의 필드: `interval`, `resultClassification` enum(NORMAL_SINUS_RHYTHM, ATRIAL_FIBRILLATION,
  INCONCLUSIVE, INCONCLUSIVE_HIGH/LOW_HEART_RATE, UNREADABLE, NOT_ANALYZED), `waveformSamples: int[]`, `beatsPerMinuteAvg`(int64 문자열),
  `samplingFrequencyHertz`, `millivoltsScalingFactor`, `leadNumber`, `medicalDeviceInfo`. 필터는 `electrocardiogram.interval.start_time`이며 **`>=`만** 지원한다.
  - **지원 기기는 Charge 5/6, Edge, Sense/Sense 2, Pixel Watch 1~4다. Fitbit Air는 목록에 없다.**
- `irregular-rhythm-notification`(Session, list만 가능, 웹훅 ✗)의 필드: `interval`, `alertWindows[]`({start/endTime, `positive`, `heartBeats[]`{physicalTime, beatsPerMinute}}), `medicalDeviceInfo`.
  **Fitbit Air는 지원 기기다.** 이와 별개로 `GET users/me/irnProfile`(`getIrnProfile`)이 IRN 기능 사용 여부를 돌려준다.
- 검증([app-verification](https://developers.google.com/health/app-verification)): "대부분의 스코프가 restricted"이고, 공개 서비스에는
  OAuth 검증과 CASA(연 1회, $500~4,500)가 필요하다. 미검증 앱의 상한은 **100명**이다. ECG/IRN 스코프의 등급은 문서에 명시되어 있지 않다.
  U1 스파이크에서 미검증 + Production 상태로 소유자 본인 데이터를 restricted 스코프로 읽을 수 있음은 이미 확인했다.
  새 스코프도 GCP 콘솔 "Data access"에 추가해야 동의 화면에 나온다.

---

## 조사 결과 B — 라이브 스파이크 (2026-11-09, 소유자 계정, Fitbit Air)

부여된 스코프는 현재 세 개(activity, metrics, sleep)와 openid다. `ecg`/`irn`은 없다.

### B1. 신규 타입

| 호출 | 결과 | 형태 / 출처 (`platform \| packageName \| formFactor \| recordingMethod`) |
|---|---|---|
| `list daily-vo2-max` (`daily_vo2_max.date >= 1년 전`) | 200 `{}` | 비어 있음 |
| `list run-vo2-max` (`run_vo2_max.sample_time.physical_time`) | 200 `{}` | 비어 있음 |
| `list vo2-max` (참고) | 200, 5건 | `HEALTH_CONNECT\|com.sec.android.app.shealth\|-\|UNKNOWN`. 래퍼에 `measurementMethod`(string)가 있다. Fitbit 측 VO2max는 아직 없다 |
| `list weight` (30일) | 200, 12건 | `HEALTH_CONNECT\|com.withings.wiscale2\|SCALE\|PASSIVELY_MEASURED`. `weightGrams`는 **number**이고 `device.manufacturer: "Withings"` |
| `list body-fat` (30일) | 200, 12건 | weight와 같은 Withings 출처. `percentage`는 number |
| `list height` (1년) | 200, 1건 | `FITBIT\|-\|-\|MANUAL`. `heightMillimeters`는 **숫자 문자열** |
| `list blood-glucose` | 200 `{}` | 비어 있음 |
| `list core-body-temperature` | 200 `{}` | 비어 있음 |
| `list floors` | **400** `UNSUPPORTED_DATA_TYPE_ACTION` | "supported: reconcile, rollup, dailyRollup" |
| `dailyRollUp floors` / `reconcile floors` / `rollUp floors 3600s` | 200 `{}` | 비어 있음. Fitbit Air에는 기압계가 없는 것으로 보인다 |
| `list total-calories` | **400** `UNSUPPORTED_DATA_TYPE_ACTION` | rollup 전용 |
| `dailyRollUp total-calories` (7일) | 200, 7건 | `{ civilStartTime:{date,time:{}}, civilEndTime:{…}, totalCalories:{ kcalSum: number } }`. **`dataSource` 없음** |
| `dailyRollUp total-calories` (30일) | 200, **14건 + `nextPageToken`** | 30일 범위를 요청해도 오류는 나지 않는다. 한 페이지에 14일씩 나뉘어 온다 |
| `dailyRollUp weight` | 200 | `weight.weightGramsAvg` |
| `dailyRollUp steps` | 200 | `steps.countSum`(**문자열**) |
| `list electrocardiogram` / `list irregular-rhythm-notification` | **403** `MISSING_OAUTH_SCOPE` | 예상대로다 |
| `v4beta list skin-temperature-sensors` | 200 `{}` | 비어 있음. v4beta 엔드포인트 자체는 같은 토큰으로 접근된다 |
| `GET users/me/identity` | 200 | `{ name, legacyUserId(6자), healthUserId(19자리 숫자 문자열) }`. **`health_connections.google_sub`(21자리)과 값이 다르다** |
| `GET users/me/pairedDevices`, `GET users/me/irnProfile` | 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT` | 추가 스코프가 필요하다(irn, 또는 settings/profile) |

추가로 확인한 사항:
- **`dailyRollUp`의 body 형태가 처음으로 200으로 검증됐다**: `{ range: { start: { date: {year,month,day} }, end: { date: {…} } }, windowSizeDays: 1 }`.
  스파이크 문서 §4의 "unverified"는 이로써 해소된다. 응답 키는 `rollupDataPoints`다.
- 모든 `list` 포인트에 **`name`**(데이터 포인트 리소스명)이 있다. 웹훅 `recordId`, `dataPoints.get`과 이어 붙일 수 있는 식별자다.
- 래퍼의 `sampleTime`에 출력 전용 `civilTime{date,time}`이 함께 온다. 숫자는 number다.

### B2. dataSourceFamily (steps, 최근 30일, 전 페이지 합산)

| family | 포인트 | 출처 분포 |
|---|---|---|
| (지정 안 함) = `all-sources` | 5,466 | FITBIT 1,903 · `com.android.healthconnect.phone`(PHONE) 3,533 · shealth 30 |
| `google-wearables` | 1,903 | FITBIT만 |
| `google-sources` | 1,903 | FITBIT만. **HC 폰 만보계와 Samsung Health는 1st-party로 치지 않는다** |
| `self-sources` | 0 | — |
| `dataSourceFamily=google-wearables` (짧은 형태) | 400 `INVALID_ARGUMENT` "Data family is missing or is not supported" | — |

- `list heart-rate` + `google-wearables`는 200이고 FITBIT만 온다(`device.displayName: "Fitbit Air"`).
- `list sleep` + family는 **400 `INVALID_DATA_POINT_DATA_SOURCE_FAMILY`**("Only the default (all-sources) is supported")다.
- `reconcile sleep` + `google-wearables`(`sleep.interval.civil_end_time >= …`)는 200이다. 응답 형태는 `list`와 다르다.
  `dataPointName`이 있고 `dataSource`가 **없다.** `summary{minutesInSleepPeriod, minutesAsleep, minutesAwake, minutesToFallAsleep, minutesAfterWakeUp, stagesSummary[]}`, `shortAwakenings[]`, `metadata{stagesStatus, processed, mainSleep}`가 들어 있다(대부분 숫자 문자열).
- `list exercise` + `google-wearables`는 200이다(FITBIT, `FITNESS_BAND`, PASSIVELY/ACTIVELY_MEASURED). 한 페이지가 약 25건으로 작다.

**dailyRollUp과 우리 KST 일별 요약 비교** (steps, 최근 8일, 비율만 기록):
- 대부분의 날에서 `ours / google-wearables rollup` = **1.000**이다(0.990~1.000). → `dailyRollUp`의 civil day가 KST day와 같다는 뜻이다.
  CLAUDE.md의 "Google dailyRollUp 버킷은 Google 서버 TZ"라는 우려는 적어도 이 계정에서는 **사실이 아니다.**
- `google-wearables / all-sources rollup` = 0.36~0.99다. → **`all-sources` 롤업은 출처를 합산해서 중복으로 센다.** 기본값 그대로는 쓸 수 없다.
- 하루(10-31)는 `ours / wearables` = 18이었다. 그날은 밴드를 차지 않았고, 우리 dominant-source 규칙이 폰을 골랐다.
  `google-wearables`로만 걸렀다면 그날 걸음 수는 거의 0이 됐을 것이다.

### B3. (부수 발견) 세션 타입은 시간 필터가 **된다** — exercise 히스토리가 누락되고 있다

U1과 §6의 "`sleep`/`exercise`는 모든 filter가 400"은 `*.interval.start_time`만 시도해서 나온 결론이었다. 문서가 정한 필드로 시도하면 통과한다.

| 필터 | 결과 |
|---|---|
| `sleep.interval.end_time >= "<rfc3339>"` | 200, 정확히 7일 범위만 반환 |
| `sleep.interval.civil_end_time >= "YYYY-MM-DD" AND … < "…"` | 200, 닫힌-열린 구간이 동작한다 |
| `sleep.interval.start_time >= …` | 400 `INVALID_DATA_POINT_FILTER_DATA_TYPE_MEMBER` (기존 관찰과 같다) |
| `exercise.interval.civil_start_time >= "YYYY-MM-DD"` | 200, 범위가 맞다(36건, 2페이지) |

또한 exercise를 필터 없이 조회하면 **38페이지, 938건(2025-07-08부터)**이다. 그런데 `syncSessions`는 `SESSION_MAX_PAGES = 10`에서
멈추고, 한 페이지가 약 25건이라 **가장 최근 약 250건만** 매번 다시 읽는다. dev DB의 exercise는 638건이고 shealth 기준 가장 오래된 것이
2025-11-14다. **약 300건, 2025-07~11의 운동 기록이 들어온 적이 없다.** sleep은 API 128건, DB 127건으로 문제가 없다.

---

## 설계

### 0. (선행, 독립 PR) 세션 sync를 시간 창 방식으로 전환

- `MetricConfig`에 `filterField`를 실제로 동작하는 값으로 넣는다. sleep은 `sleep.interval.end_time`(physical, 기존 `buildTimeFilter`와 같은 RFC 3339),
  exercise는 `exercise.interval.civil_start_time`(civil이다. KST 날짜 문자열로 넘기고, 경계 하루를 겹쳐 잡는다).
  `MetricTimeShape`에 `civilInterval`을 추가해 `buildTimeFilter`가 날짜 문자열을 만들게 한다.
- 세션을 `HEALTH_METRICS`의 일반 경로(정방향 watermark + 14일 청크 백필)로 옮기고, 매번 전체를 다시 읽던 방식은 없앤다.
  `valueKey: null`이 정형 `valueJson`으로 가는 분기는 이미 있다. 백필이 끝나면 누락된 300건이 자동으로 들어온다.
- 세션은 시간이 지나면서 수정된다(재처리 후 `updateTime`이 바뀌는 등). 따라서 `revisable: true`로 DO UPDATE한다. 정체성(시작 초, 출처)은 바뀌지 않는다.
- `sessions.ts`의 읽기 시점 dedup은 그대로 둔다.
- 테스트: `buildTimeFilter`에 civil 형태 케이스를 추가하고, `parseExerciseWorkout`/`parseSleepSession`은 기존 테스트를 재사용한다.
  백필 presence probe가 civil 필터에서도 동작하는지 확인하는 단위 테스트를 둔다.

### 1. `health_user_id` 매핑 (마이그레이션 0045)

- `health_connections.health_user_id text`(nullable)와 `UNIQUE (health_user_id) WHERE health_user_id IS NOT NULL`을 추가한다.
- 어댑터에 `getIdentity(accessToken)`를 추가한다. `/api/fitbit/callback`에서 토큰을 교환한 직후 저장하고,
  기존 연결은 다음 `syncUser`에서 null이면 한 번 채운다(지연 백필, 추가 동의는 필요 없음. 스파이크에서 200 확인).
- `legacyUserId`는 Google 정책상 마이그레이션 매핑 외에는 쓸 수 없으므로 저장하지 않는다.

### 2. 신규 데이터 타입

**2a. `list` 기반 — `HEALTH_METRICS`에 행만 추가**

| key | dataType | wrapper | timeShape | filterField | valueKey | agg | 비고 |
|---|---|---|---|---|---|---|---|
| `daily_vo2_max` | `daily-vo2-max` | `dailyVo2Max` | date | `daily_vo2_max.date` | `vo2Max` | avg | `revisable: true`. `cardioFitnessLevel`은 raw page에 남는다 |
| `run_vo2_max` | `run-vo2-max` | `runVo2Max` | sampleTime | `run_vo2_max.sample_time.physical_time` | `runVo2Max` | avg | |
| `core_body_temperature` | `core-body-temperature` | `coreBodyTemperature` | sampleTime | `core_body_temperature.sample_time.physical_time` | `temperatureCelsius` | avg | 웹훅 ✗ |
| `blood_glucose` | `blood-glucose` | `bloodGlucose` | sampleTime | `blood_glucose.sample_time.physical_time` | `bloodGlucoseMilligramsPerDeciliter` | avg | CGM 데이터는 분 단위라 heart_rate처럼 커질 수 있다. 실제 데이터가 생기면 compaction 대상에 넣을지 다시 판단한다 |

- 지금 데이터가 있는 것은 하나도 없다(B1). config 행은 "연결됨, 데이터 없음" 상태와 이후 자동 수집을 위한 것이다.
  백필 presence probe가 첫 실행에서 바로 완료 처리하므로 비용은 거의 없다.
- **daily_vo2_max vs vo2_max**: UI의 `vo2_max` 카드는 shealth 데이터가 2026-04에 끊겼다. Fitbit 측 값은 `daily-vo2-max`로 올 것이므로
  `metrics-meta`에서 두 키를 하나의 "VO₂max" 카드로 합칠지 결정이 필요하다(아래 결정 목록).
- **weight / body-fat / height**는 계속 동기화하지 않는다(§6 결정 유지). 데이터 출처가 `com.withings.wiscale2`이고, Withings 통합이 더 풍부한 필드를 갖고 있다.
  단, 웹훅에서 `weight` 알림을 받으면 그것을 **Withings sync를 앞당기는 트리거**로 쓸 수 있다(24h 게이트를 무시하고 1회 실행). 결정 목록 참고.

**2b. 롤업 전용 — 새 fetch 경로**

`MetricConfig`에 `fetch: "list" | "dailyRollUp"`(기본 `list`), `rollupValueKey`, `rollupFamily?`를 추가한다.

| key | dataType | fetch | rollupValueKey | family | agg |
|---|---|---|---|---|---|
| `total_calories` | `total-calories` | dailyRollUp | `totalCalories.kcalSum` | **결정 필요** (`google-wearables` 제안) | sum |
| `floors` | `floors` | dailyRollUp | (빈 응답이라 미확인) | 같음 | sum |

- 롤업 포인트는 `civilStartTime.date` 기준으로 기존 `date` timeShape와 똑같이 **12:00 KST로 고정**한다. `revisable: true`로 DO UPDATE하고,
  `source = "rollup:<family>"`로 둔다. dataSource가 없으므로 출처는 우리가 붙인다.
  `recomputeDailySummaries`는 기존 그대로 이 소스 하나를 dominant로 고른다.
- 정방향: `[syncedThrough의 KST 날짜 - 1일, 오늘 + 1일)` 범위를 `nextPageToken`을 따라가며 요청한다(14일/페이지).
  백필: 14일 청크를 그대로 쓴다. presence probe는 `dailyRollUp` 범위 전체를 요청해 `rollupDataPoints`가 비었는지로 대신한다.
  0이 들어 있는 날도 포인트로 오는지는 floors 데이터가 없어 확인하지 못했다. 테스트는 두 경우 모두 다룬다.
- 기존 metric `floors`에 붙어 있던 "invalid dataType" 기록(§6의 `floors-climbed`)과는 다른 ID다. `floors`는 유효하다.
- **total-calories의 family**: `all-sources` 롤업은 출처를 합산하므로 쓸 수 없다(B2). `google-wearables`는 밴드를 차지 않은 날 BMR만 남을 수 있다.
  칼로리는 걸음 수와 달리 기초대사량이 대부분이라 영향이 작다고 보고 `google-wearables`를 제안한다.
- 어댑터의 `dailyRollUp`에 `dataSourceFamily?`를 추가하고, "Response key not yet confirmed" 주석을 `rollupDataPoints`로 확정한다.

**2c. 범위 밖**: `skin-temperature-sensors`(v4beta이고 Fitbit Air는 비대상이며 분 단위 원시값), `height`(수동 1건, 프로필 성격).

### 3. dataSourceFamily

- **저장 경로(`list` → `health_samples`)에는 적용하지 않는다.** 이유는 세 가지다.
  (1) "출처를 모두 보존하고 나중에 다시 계산한다"는 §5 원칙에 어긋난다.
  (2) B2 실측에서 `google-wearables` 롤업 = 우리 dominant-source 결과가 정확히 일치했다. 지금 방식이 이미 같은 답을 내고 있다.
  (3) 밴드를 차지 않은 날(10-31)은 우리 방식만 맞는다.
- 쓰는 곳은 다음과 같다.
  1. 2b의 롤업 전용 메트릭(`rollupFamily`).
  2. **교정 스크립트** `scripts/calibrate-health-dominant-source.ts`(읽기 전용): 최근 N일에 대해 `google-wearables` dailyRollUp과
     `health_daily_summaries`를 비교하고, 일치율과 불일치한 날의 원인(미착용, 늦은 업로드)을 출력한다. 사용자 메모리의 "경험적 교정 선호"에 맞춘 것이다.
     dominant-source 규칙을 바꿀 근거가 생기면 이 스크립트로 판단한다.
  3. (선택) heart_rate 정방향 sync에 `google-wearables`를 쓰면 볼륨이 줄어든다. 그러나 shealth heart_rate는 2026-07 이후로 이미 0건이므로
     **얻는 것이 없어 하지 않는다.**
- sleep: `list`는 family가 400이다. `reconcile`은 되지만 출처 하나로 합쳐진 결과(dataSource 없음)라 `sessions.ts`의 provenance 규칙을 대신할 수 없다.
  **sessions.ts는 바꾸지 않는다.** reconcile sleep의 `summary`(minutesAsleep 등)는 유용하지만, 지금 hypnogram에서 직접 계산하는 값과 겹친다.

### 4. 웹훅

**4a. 등록 (운영자 1회, 코드 밖)**
- `scripts/google-health-subscriber.ts {create|list|patch|delete}`. 운영자 머신에서 실행하고, 서비스 계정 키나 `gcloud auth application-default login`
  (cloud-platform)을 쓴다. **서비스 계정 키는 컨테이너나 `.env`에 두지 않는다.** 런타임에는 필요하지 않다.
- env는 `GOOGLE_HEALTH_PROJECT_NUMBER`(스크립트용)와 `GOOGLE_HEALTH_WEBHOOK_SECRET`(web 컨테이너, 32바이트 이상 랜덤, `Bearer `로 시작)이다.
  `.env.example`과 CLAUDE.md의 env 목록을 함께 갱신한다.
- `subscriberId: "cistory-prod"`, `endpointUri: https://cistory.hojoon.dev/api/fitbit/webhook`, `subscriptionCreatePolicy: AUTOMATIC`.
  dataTypes는 우리가 동기화하는 타입 중 웹훅을 지원하는 것만 넣는다: steps, distance, heart-rate, active-zone-minutes, heart-rate-variability,
  daily-resting-heart-rate, daily-heart-rate-variability, daily-oxygen-saturation, daily-respiratory-rate, daily-sleep-temperature-derivations,
  sleep, exercise, run-vo2-max, blood-glucose, floors, (total-calories는 등록 시도로 확인), (weight는 Withings 트리거를 쓰기로 할 때만).
  **heart-rate는 알림 빈도가 가장 높으므로** 넣을지 결정이 필요하다(결정 목록).
- dev/스테이징용 subscriber는 따로 만들지 않는다. 공개 HTTPS가 없기 때문이다. 로컬에서는 라우트를 단위 테스트로만 검증한다.

**4b. 수신 라우트 — `src/app/api/fitbit/webhook/route.ts` (web 컨테이너)**

`/api/fitbit/` 아래에 두면 `sentry-scrub.ts`의 `HEALTH_URL_MARKERS`가 그대로 적용된다. 세션 인증은 하지 않는다.
처리 순서는 다음과 같다(`api-auth.ts` 스타일을 따르되 API 키 대신 secret과 서명을 쓴다).

1. `bodyExceedsLimit`를 웹훅 전용 상한 **256 KB**로 호출한다(99건 × 수백 바이트이고 여유를 둔 값). 초과하면 413.
2. `request.text()`로 **원문 바이트를 먼저** 읽는다. 서명 검증은 파싱 전의 원문으로 해야 한다.
3. `Authorization`을 `timingSafeEqual`로 `GOOGLE_HEALTH_WEBHOOK_SECRET`과 비교하고, 다르면 **401**. 이 동작이 검증 핸드셰이크의 "인증 없는 요청 → 401" 조건도 충족한다.
4. body가 `{"type":"verification"}`이면 **200**으로 끝낸다. 검증 요청에 서명이 붙는지는 문서에 없으므로, 서명이 없어도 secret만 맞으면 200을 준다.
5. 그 밖의 요청은 `GOOGLE-HEALTH-API-SIGNATURE`를 검증한다(A1 방식, `src/lib/google-health-webhook-signature.ts`, 순수 함수와 keyset 캐시). 실패하면 **401**.
   keyset을 가져오다 실패하면(네트워크) **503**을 준다. Google이 재시도하므로 데이터는 잃지 않는다.
6. 파싱(zod)한 뒤 `healthUserId → user_id`를 `health_connections.health_user_id`로 조회한다(배치에 있는 ID를 한 번에).
   모르는 사용자나 status `needs_reauth`는 버리고 개수만 로그에 남긴다.
7. `health_webhook_events`에 다중 행 INSERT … `ON CONFLICT DO NOTHING`을 하고 **204**로 응답한다. Google API 호출, 집계, 대기 루프는 하지 않는다.
- rate limit: Google의 송신 IP가 정해져 있지 않아 키+IP 리미터가 맞지 않는다. 인증과 서명이 실패한 요청만 `enforceRateLimit(key="gh-webhook-unauth")`로 막는다.
  `logIngestionFailure`로 실패를 기록하고, `recordSourceSuccess("health")`로 수신 성공 시각을 남긴다.
- 로그에는 개수, dataType, operation만 남긴다. `healthUserId`와 interval 시각은 로그에 쓰지 않는다.

**4c. 큐 테이블 — `health_webhook_events` (마이그레이션 0046)**

```
id uuid pk, user_id uuid fk users ON DELETE cascade, data_type text, operation text,
range_start timestamp, range_end timestamp,   -- UTC wall time. physical이 없으면 civil 날짜 ± KST로 환산
record_id text null, received_at timestamp, status text ('pending'|'processing'|'done'|'failed'),
attempts int, lease_token uuid null, lease_expires_at timestamp null, last_error text null
UNIQUE (user_id, data_type, operation, range_start, range_end, coalesce(record_id,''))   -- 재전송 중복 흡수
INDEX (status, received_at)
```

- 타임스탬프는 `timestampParam`으로 바인딩한다(raw `now()`를 쓰면 9시간 함정에 빠진다). `done` 행은 7일 뒤 cron이 지운다.
- `data_usage`의 health 카테고리에 넣는다. `account-deletion`은 cascade로 처리되지만 integration test에 테이블을 추가한다.

**4d. 소비자 — cron 컨테이너**

- `registerHealthWebhookTask`: `* * * * *`, `timezone: "Asia/Seoul"`, 클로저 로컬 `running` 플래그를 두고, `data-recovery`처럼
  `FOR UPDATE SKIP LOCKED` + `lease_token` 5분 리스로 동작한다.
- 한 번 실행할 때 pending 이벤트를 `(user_id, data_type)`으로 묶어 `[min(range_start) − 1h, max(range_end) + 1h)`로 합친다.
  `HEALTH_METRICS`, 세션, 롤업 config에서 dataType을 찾아 **`fetchWindowAndPersist`(재사용)로 그 창만 다시 읽고 upsert**한 뒤,
  `recomputeDailySummaries`가 닿은 날을 다시 계산한다. **`syncedThrough`는 움직이지 않는다.** 웹훅 창은 연속이 아니므로
  정방향 watermark의 의미를 깨면 안 된다. 폴링이 safety net으로 남는다.
- 한 tick의 상한은 사용자당 dataType 20개, 창 하나에 최대 14일이다. 그보다 긴 창은 잘라서 남기고 다음 tick에 처리한다.
- 토큰 갱신과 `needs_reauth` 처리는 기존 `listPageWithAuth`를 그대로 쓴다. 갱신 실패로 `needs_reauth`가 되면 이벤트를 `failed`로 처리한다.
- **`DELETE` 처리 → 결정 필요.** 제안은 1단계에서 **무시하고 로그만 남기는 것**이다(lossless 아카이브 원칙, 그리고 recovery의 "빈 응답으로는 이력을 지우지 않는다"와 같은 입장).
  삭제를 반영하려면 `health_samples`에 데이터 포인트 `name`(recordId) 컬럼이 필요한데, heart_rate 수백만 행 테이블에 컬럼을 추가하는 일이라 별도로 설계해야 한다.
- 처리된 창은 `/overview` 스냅샷을 무효화해야 한다. 지금 정방향 sync가 하는 것과 같은 범위로 하며,
  `data-status` recovery 완료 경로의 무효화 헬퍼를 재사용한다.

**4e. 폴링과의 관계**
- 24h 정방향 sync와 백필은 **그대로 둔다.** 웹훅을 지원하지 않는 타입, 웹훅 이전 이력, 7일 넘게 다운된 경우, Health Connect 경유 데이터의 알림 여부(미확인)를 모두 폴링이 메운다.
- 2주 정도 운영한 뒤 **"웹훅이 놓친 비율"**을 측정한다. 폴링이 가져온 행 가운데 웹훅 처리 이후 새로 생긴 행의 비율을 보고, 그 결과로 게이트를 바꿀지 판단한다. 지금은 바꾸지 않는다.

**4f. 인프라 체크리스트**
- `cistory.hojoon.dev` 앞단(리버스 프록시, Cloudflare 등)이 `Authorization` 헤더를 그대로 넘기고, UA `Google-Health-API-Webhooks`를 봇으로 차단하지 않으며, POST body를 버퍼링하더라도 원문을 바꾸지 않는지 확인한다.
- web 컨테이너에 `GOOGLE_HEALTH_WEBHOOK_SECRET`을 넣는다. cron 컨테이너에는 필요 없다.
- Jenkins 배포 중 web 컨테이너가 내려가 있는 동안 온 알림은 Google이 재시도하므로 문제가 없다(7일 보관).
- GCP 콘솔의 Health API "subscriber errors" 지표와 알림을 켠다(2026-05 릴리스).

### 5. ECG / IRN

- **스코프**: `GOOGLE_HEALTH_DEFAULT_SCOPE`는 그대로 두고 `GOOGLE_HEALTH_OPTIONAL_SCOPES = { ecg, irn }`을 추가한다.
  `/api/fitbit/authorize?extra=ecg,irn`을 받으면 기본 스코프에 추가 스코프를 더해 요청한다. `include_granted_scopes=true`는 이미 켜져 있다.
  콜백은 응답의 `scope`를 저장한다(이미 그렇게 한다). Google 세분화 동의 화면에서 사용자가 일부를 끌 수 있으므로, **저장된 `scope`로 기능을 켤지 판단**한다.
- 서비스는 `connection.scope`에 `ecg.readonly`/`irn.readonly`가 있을 때만 해당 메트릭을 sync한다. 그렇지 않으면 403이 매번 `lastSyncError`에 쌓인다.
- 설정 UI(연결 카드)에 "심전도·불규칙 리듬 알림 권한 추가" 버튼을 두고, 연결이 끊기지 않는 재동의 흐름을 만든다. `/privacy`에 ECG/IRN 수집 항목을 추가한다.
- GCP 콘솔: OAuth 동의 화면의 Data access에 두 스코프를 추가한다. 미검증 상태에서도 소유자 계정으로 restricted 스코프를 쓸 수 있음은 U1에서 확인했다.
  다만 두 스코프의 등급은 문서에 없으므로 **추가한 뒤 실제 동의 → 200까지 확인한 뒤에** UI를 연다.
- **sync**: 웹훅이 없으므로 폴링만 한다.
  - ECG: `filterField: "electrocardiogram.interval.start_time"`. **`>=`만 지원**하므로 백필 청크의 상한(`<`)을 쓸 수 없다. 대신 정방향 1회로
    `>= floor` 전체를 페이지로 읽는다(건수는 측정 1회당 1건 수준). `buildTimeFilter`에 `lowerBoundOnly` 플래그를 추가한다.
  - IRN: 필터 필드가 문서화되어 있지 않다. 스코프를 받은 뒤 `irregular_rhythm_notification.interval.start_time`을 시도하고, 실패하면 세션처럼 필터 없이 읽는다.
- **저장 — 결정 필요.** 제안:
  - `health_samples`: `metric = "ecg"`, `value = beatsPerMinuteAvg`(문자열을 숫자로 변환), `valueJson = { resultClassification, samplingFrequencyHertz, millivoltsScalingFactor, leadNumber, medicalDeviceInfo }`. **파형은 넣지 않는다.**
  - 파형은 별도 테이블 `health_ecg_waveforms(user_id fk cascade, sample_at, source, samples int2[]/bytea)`에 둔다(마이그레이션 0047). `/health`에서 그릴 때만 읽는다.
  - `metric = "irn"`: `value = positive alertWindow 수`, `valueJson = alertWindows`(heartBeats 포함 여부는 결정 필요).
  - `health_raw_pages`는 원문(파형 포함)을 계속 영구 보관한다. ECG에는 **보존 기간이나 raw 제외 정책**이 필요할 수 있다(결정 목록).
  - 일별 요약은 만들지 않는다. sleep/exercise처럼 세션 읽기 경로를 쓴다.
- **표시**: 분류 enum을 한국어로 그대로 옮기고(정상 동리듬 / 심방세동 / 판정 불가 …), "의료 진단이 아닙니다 — 기기 판정 결과" 문구를 붙인다.
  우리가 파형을 다시 해석하거나 점수화하지 않는다. AI 내러티브(`/overview`)에 ECG/IRN을 넣을지도 결정이 필요하다. 넣지 않는 것을 제안한다.
- **Fitbit Air는 ECG 지원 기기가 아니다.** 지금 기기로는 ECG가 항상 비어 있다. IRN은 지원된다.

### 6. 개인정보 · Sentry

- `HEALTH_EXTRA_KEY_DENYLIST`에 `waveform`, `waveformsamples`, `alertwindows`, `heartbeats`, `resultclassification`, `electrocardiogram`, `bloodglucose`,
  `kcalsum`, `rollup`, `healthuserid`, `intervals`를 추가한다. `intervals`는 웹훅 payload의 시간 구간이다. 값은 없지만 활동 시각 자체가 개인정보다.
- 웹훅 라우트가 `/api/fitbit/` 아래에 있어 URL marker가 적용된다. route 단위 Sentry 컨텍스트에 body를 붙이지 않는다.
- `health_webhook_events`와 `health_ecg_waveforms`는 `users` cascade, `deleteAccount` integration test, `data_usage` 카테고리에 포함한다.
- 연결 해제(`DELETE /api/fitbit`)를 하면 `health_user_id`도 행과 함께 삭제된다. 이후 들어오는 알림은 "모르는 사용자"로 버려진다.
  AUTOMATIC 구독은 Google 쪽에서 토큰 revoke와 함께 멈춘다.

### 7. `/health` UI

- 롤업 메트릭(`total_calories`)과 `daily_vo2_max`는 `metrics-meta`의 `CURATED_METRICS`에 넣는다(결정 목록).
  데이터가 없는 메트릭은 기존 "연결됨, 데이터 없음" 처리를 따른다.
- ECG/IRN 카드는 스코프가 있을 때만 보인다. 최근 측정 목록에 분류와 평균 bpm을 보여주고, 펼치면 파형(recharts가 아닌 SVG polyline, 측정 1건)을 그린다.
- 연결 카드에 "실시간 동기화(웹훅) 마지막 수신 시각"을 보여준다(`source_sync_states`).

### 8. Historical backfill — 신규 타입의 과거 이력

**기존 경로**: `backfillPendingConnections`는 완료 여부를 **메트릭별로** 판단한다(`health_sync_state.backfilledFrom > backfillFloor`이면 아직 미완료).
그래서 `HEALTH_METRICS`에 행을 추가하기만 하면 그 메트릭은 자동으로 과거로 내려간다. 10분 tick마다 14일 청크를 4개씩 처리하고,
`>= floor AND < cursor` 구간에 대한 presence probe(`pageSize=1` list)가 비면 바로 종료한다. 하한은 `backfillFloor`(연결 시점 기준 약 5년 전)다.

**공식 문서상 한도**: [endpoints](https://developers.google.com/health/endpoints)에 따르면 "기록된 시점까지 거슬러 조회할 수 있고, API가 과거 데이터
소비량에 제한을 두지 않는다". API가 정한 보존 한도는 없다. 대신 **롤업은 요청 1회당 범위 상한**이 있다. `total-calories`·`heart-rate`·
`active-minutes`·`calories-in-heart-rate-zone`은 14일, 나머지 롤업 타입은 90일이다. 실측에서는 40일 범위로 요청해도 오류가 나지 않았고,
14건과 `nextPageToken`으로 페이지가 나뉘어 왔다. 보존 기간 자체(Google이 얼마나 오래 들고 있는지)는 문서에 없다.

**실측 (2026-11-09, `>= 2010-01-01`로 전 페이지를 읽음. 롤업은 월별 1일과 90일 청크로 2019년까지 탐색. 날짜만 기록)**

| 타입 | 가장 오래된 포인트 | 건수 / 출처 | 기존 백필 경로 적합성 |
|---|---|---|---|
| `daily-vo2-max` | — (없음) | 0 | **적합** (list, `date` timeShape). 첫 presence probe에서 바로 완료 처리된다 |
| `run-vo2-max` | — (없음) | 0 | **적합** (list, sampleTime) |
| `vo2-max` (참고, 기존) | 2025-07-08 | 29, shealth만 | 기존과 같다 |
| `weight` | **2025-08-12** | 94: Withings 46 · **shealth 47** · FITBIT 1 | 적합 (list, sampleTime). 동기화는 계속 제외한다(§2a). 다만 shealth 출처 47건이 Withings 통합(`body_measurements`)에 있는 이력과 같은지는 확인이 필요하다 |
| `body-fat` | **2025-08-12** | 92: Withings 45 · shealth 47 | 적합. 동기화 제외(위와 같음) |
| `height` | 2026-07-09 | 1, FITBIT(MANUAL) | 적합. 동기화 제외 |
| `blood-glucose` | — (없음) | 0 | **적합** (list, sampleTime) |
| `core-body-temperature` | — (없음) | 0 | **적합** (list, sampleTime) |
| `total-calories` | **2025-07-08** | 2025-07-08 이후 데이터가 있는 날에만 포인트가 온다. 빈 달도 섞여 있다(2025-11, 2026-01~03, 2026-05~06 등). 2019~2025-06은 전부 없음 | **부적합 — 롤업 전용 경로가 필요하다.** list가 400이라 presence probe를 쓸 수 없다. 데이터가 없는 날은 0이 아니라 **포인트 자체가 없다** |
| `floors` | — (없음) | 2018-10~현재 90일 청크가 모두 0 (청크 하나는 503이 났고, 재시도하니 0) | 부적합(롤업 전용). 이 기기로는 영구히 비어 있을 가능성이 높다 |
| `electrocardiogram` | **확인 불가** | 스코프가 없어 403 `MISSING_OAUTH_SCOPE` | **부분 적합.** 필터가 `>=`만 지원하므로 청크의 `< cursor` 상한을 쓸 수 없다 |
| `irregular-rhythm-notification` | **확인 불가** | 403 | **미정.** 필터 필드가 문서화되어 있지 않다 |

`2025-07-08`은 이 계정의 Health Connect 이력이 시작된 날로 보인다. vo2-max, exercise, total-calories의 가장 오래된 날짜가 모두 이 날짜다.
2019년까지 탐색했지만 그 이전 데이터는 어떤 타입에서도 나오지 않았다.

**타입별 처리**

- **list 기반 6종(daily-vo2-max, run-vo2-max, blood-glucose, core-body-temperature, 그리고 동기화하기로 한다면 weight/body-fat/height)**:
  손댈 것이 없다. config 행만 추가하면 다음 tick부터 메트릭별 백필이 돈다. 지금 비어 있는 타입은 presence probe 1회로 완료되고,
  나중에 데이터가 생기면 정방향 sync가 받는다.
  주의: 완료 표시가 된 뒤에 **과거 날짜로** 데이터가 들어오면(예: 나중에 산 혈당계로 과거 기록을 가져옴) 정방향 cursor보다 이전이라 아무도 가져오지 않는다.
  이는 기존 메트릭에도 똑같이 있는 한계다. 웹훅 `UPSERT` 구간(§4d)이나 `/data-status` recovery로 메운다.
- **롤업 2종(total-calories, floors)**: `backfillMetric`에 `fetch: "dailyRollUp"` 분기를 추가한다.
  - 청크는 14일로, total-calories의 요청 상한과 같고 floors의 90일 상한보다 작다. 기존 `BACKFILL_CHUNK_MS`를 그대로 쓴다.
  - presence probe를 쓸 수 없다. list가 없고, 롤업 1회로는 남은 전체 범위를 덮을 수 없기 때문이다. 대신 **하한을 연결의 "가장 오래된 관측일"로 둔다.**
    `min(health_samples.sample_at)`(이 계정은 2025-07-08)에서 하루를 뺀 날짜다. 거기까지는 빈 청크가 이어져도 계속 내려간다.
    그 아래로는 내려가지 않는다. 기존 `backfillFloor`(약 5년) 그대로 내려가면 약 130번 호출(4청크/tick 기준 약 33 tick, 5.5시간)로도 끝나기는 하지만,
    빈 롤업 수백 번은 낭비다.
    total-calories에는 빈 달이 있다(위 표). 따라서 "빈 청크가 나오면 중단"은 **안 된다.**
  - 그 밖의 동작은 같다: 12:00 KST 고정, `revisable` DO UPDATE, `source = "rollup:<family>"`.
- **ECG**: `>=`만 지원하므로 14일 청크 백필을 쓸 수 없다. 스코프를 받은 첫 sync에서 `electrocardiogram.interval.start_time >= backfillFloor`를
  **newest-first로 끝까지 페이지를 읽어** 한 번에 가져온다. 측정 1회당 1건이라 건수가 적다. 이후에는 같은 필터를 `>= syncedThrough − 1일`로 바꿔 정방향 sync를 한다.
  **페이지 상한은 두지 않는다**(또는 아주 크게 둔다). `SESSION_MAX_PAGES`가 exercise 이력을 잘라먹은 일(§0, B3)을 되풀이하지 않기 위해서다.
  다만 페이지 하나에 파형이 담긴다면 응답이 크다. 첫 실행은 tick 하나당 N페이지까지만 처리하고, 이어 읽을 `pageToken`은 저장하지 않는다
  (나중에 `start_time` 기준으로 다시 읽어도 멱등이다). 이 방식을 그대로 쓸지는 첫 실측 뒤에 정한다.
- **IRN**: `irregular_rhythm_notification.interval.start_time` 필터가 통하면 일반 백필 경로에 넣는다. 통하지 않으면 필터 없이 newest-first로 읽되,
  ECG와 같이 페이지 상한 없이 끝까지 읽는다. 이력이 나오는지, 즉 스코프를 받은 뒤 과거 알림까지 돌려주는지는 **스코프를 부여해 실측해야 알 수 있다.**
  문서상으로는 list가 "기록된 시점까지" 조회되므로 이력이 나올 것으로 예상하지만, 확인되지 않았다. 롤아웃 5단계의 스파이크 항목이다.
  Fitbit Air는 IRN 지원 기기이고 ECG는 비대상이므로, 이 계정에서는 ECG 이력이 0건일 것으로 예상한다.
- **웹훅에는 백필이 없다**(AUTOMATIC 구독도 생성 이전 데이터는 보내지 않음). 따라서 과거 이력은 언제나 위 폴링 백필이 맡는다.

---

## 마이그레이션

| 번호 | 내용 | 비고 |
|---|---|---|
| 0045 | `health_connections.health_user_id` + 부분 unique | 비파괴. 값은 지연 백필 |
| 0046 | `health_webhook_events` | users cascade |
| 0047 | `health_ecg_waveforms` (ECG를 진행할 때만) | users cascade |

세션 시간 창 전환(§0)과 신규 메트릭 행(§2)에는 스키마 변경이 없다. `health_sync_state`에 새 metric 행이 자연스럽게 생긴다.

## 테스트

- **단위**
  - 서명 검증: Tink 형식 keyset fixture(테스트에서 생성한 P-256 키), 올바른 서명, 1바이트 변조, 모르는 keyId(keyset 재조회), 잘못된 prefix, DER과 P1363 혼동.
  - 라우트: verification 요청(인증 있음 200, 없음 401), 잘못된 secret 401, 서명 실패 401, 256 KB 초과 413, 99건 배치 → 204와 INSERT 1회, 모르는 healthUserId는 버림, keyset 조회 실패 503.
  - interval 환산: physical 있음, physical 없이 civil만(daily) → KST 날짜 경계의 UTC wall time.
  - `buildTimeFilter`: civilInterval, lowerBoundOnly(ECG).
  - 롤업 파서: `kcalSum` number, `countSum` 문자열, `civilStartTime`을 12:00 KST로 고정.
  - `HEALTH_METRICS` 스냅샷 테스트: 신규 행의 filterField는 snake_case여야 하고, 롤업 메트릭은 `list`를 쓰지 않아야 한다.
  - `sentry-scrub`: 새 denylist 키.
- **integration** (`*.integration.test.ts`를 하나 추가): `health_webhook_events`의 UNIQUE가 재전송을 흡수하는지, SKIP LOCKED로 두 워커가 같은 이벤트를 가져가지 않는지,
  `timestampParam` 경로로 `range_start`가 UTC wall time으로 저장되는지(TZ=Asia/Seoul 컨테이너에서).
- **`_routes-import.test.ts`**는 새 라우트를 자동으로 포함한다.
- **수동**: subscriber create(검증 핸드셰이크 통과), Fitbit 앱에서 걷기 → 알림 수신 지연 측정, Withings 체중 측정 → `weight` 알림이 오는지,
  Samsung Health 데이터 → 알림 여부(HC 경유 데이터의 알림 여부 확인), heart-rate 알림 빈도와 배치 크기 측정.

## 롤아웃 순서

1. **§0 세션 시간 창 전환**(독립 버그 수정). 배포 후 exercise 백필이 2025-07까지 내려가는지 확인한다.
2. **§1 + §2a** (`health_user_id`, list 기반 신규 메트릭). 위험이 낮다.
3. **§2b 롤업 경로 + total_calories**. 교정 스크립트(§3)를 함께 넣는다.
4. **§4 웹훅**: 라우트와 큐를 `GOOGLE_HEALTH_WEBHOOKS_ENABLED`(cron 소비자 게이트) 뒤에 두고 배포한다 → 프록시를 점검한다 → `scripts/google-health-subscriber.ts create` → 2주 관측 → 게이트 조정 여부를 검토한다.
   등록 전에 라우트가 배포되어 있어야 한다(검증 핸드셰이크).
5. **§5 ECG/IRN**: GCP 콘솔에서 스코프 추가 → 수동 재동의 → 200과 IRN 형태를 스파이크로 확인 → 저장과 UI.

## 위험

- **HC 경유 데이터의 웹훅 미발송 가능성**: 문서는 지원 기기를 Fitbit과 Pixel로만 적고 있다. 그렇다면 shealth와 Withings 데이터는 폴링에만 의존한다. 폴링을 유지하므로 데이터 손실은 없다.
- **heart-rate 알림 폭주**: 약 2.3초 간격 샘플이다. 배치로 묶여 오더라도 이벤트 행이 많아질 수 있다. UNIQUE와 (user, type) 병합으로 처리량은 막을 수 있다. 행 수를 관측한 뒤 heart-rate를 subscriber에서 뺄 수 있다.
- **서명 직접 구현**: Tink 형식 해석을 틀리면 모든 알림이 401이 되고 7일 뒤 유실된다(폴링이 메우긴 한다). 서명 검증 실패율을 알림 지표로 두고, 초기에는 `…_SIGNATURE_MODE=log-only`로 시작한다(결정 목록).
- **미검증 앱 + 새 restricted 스코프**: Google 정책이 바뀌어 미검증 앱의 restricted 스코프 추가가 막히면 ECG/IRN을 진행할 수 없다. 기존 스코프에는 영향이 없다(점진 동의).
- **`all-sources` 롤업 중복 집계**: family를 빠뜨리면 total_calories가 약 2배가 된다. config 스냅샷 테스트로 고정한다.
- **total-calories 웹훅 지원 불일치**: 등록 시점에 확인한다. 지원되지 않으면 폴링만 쓴다.
- **세션 revisable 전환**: DO UPDATE가 Withings 재발행본까지 갱신하지만 정체성은 같으므로 dedup에는 영향이 없다.

## 확정된 결정 (2026-11-10)

1. **웹훅 인증**: `Authorization` secret은 첫날부터 **강제**한다(불일치 시 401, `timingSafeEqual` 상수 시간 비교).
   ECDSA 서명 검증은 전부 구현하되 `GOOGLE_HEALTH_WEBHOOK_SIGNATURE_MODE=log-only|enforce`(기본 `log-only`)로 처음에는 로그만 남긴다.
   검증 성공/실패 건수를 구조화 로그로 남기고, 실제 알림 몇 건이 검증되면 `enforce`로 바꾼다.
   검증은 Node 내장 `crypto`로 한다(§A1 방식, 원문 body 바이트 기준). 앞단 프록시 확인은 운영자가 등록 전에 한다(CLAUDE.md 운영 절차).
2. **subscriber 관리 자격 증명**: 운영자 머신의 gcloud 로그인(`gcloud auth print-access-token`). `scripts/google-health-subscriber.ts`
   (`create|list|get|delete`)가 `x-goog-user-project` 헤더와 함께 호출한다. 경로에는 프로젝트 **번호** `794779085130`을 쓴다
   (프로젝트 ID `cistory-fitbit-track`은 실측 403). 서비스 계정 키는 쓰지 않는다. subscriber 1개, `AUTOMATIC`.
3. **폴링 유지**: 24h 정방향 sync와 백필을 그대로 둔다.
4. **구독 타입**: heart-rate를 **포함**한다. `weight` 알림은 해당 사용자의 Withings sync를 한 번 앞당긴다
   (24h 게이트를 우회하되 디바운스해서 연속 알림이 와도 최대 1회 실행).
5. **`DELETE` 알림**: 무시하고 로그만 남긴다(큐에 넣지 않음).
6. **신규 타입 UI**: `/health`에 `total_calories`(새 카드)와 `daily_vo2_max`(기존 VO₂max 카드와 합침 — 같은 날은 `daily_vo2_max` 우선)를 보인다.
   run_vo2_max · core_body_temperature · blood_glucose · floors는 config만 둔다. weight/body-fat/height는 계속 제외한다.
7. **total_calories 출처**: `google-wearables`.
8. **ECG/IRN**: 둘 다 **선택 스코프**로 추가 동의를 받는다(기본 연결 스코프에는 넣지 않음). 설정의 Google Health 카드에
   "ECG/불규칙 심박 연결" 버튼을 두어 `include_granted_scopes`로 OAuth를 다시 돈다(두 스코프는 GCP 동의 화면에 이미 등록됨).
9. **ECG 데이터 보존·개인정보**: 요약값만 저장한다(파형 테이블 `health_ecg_waveforms`와 마이그레이션 0047는 만들지 않음).
   `health_raw_pages`는 지금처럼 원문을 보관한다. IRN `heartBeats`는 `health_samples`에 저장하지 않는다(원문에는 남음).
   `/overview` AI 내러티브 입력에서 ECG/IRN을 제외하고, payload 키를 sentry-scrub denylist에 추가한다.
   소유자 기기(Fitbit Air)에는 ECG가 없으므로 파서는 문서상 형태 기준으로 관대하게 만들고, 실제 형태는 재동의 후 확인한다.
10. **세션 sync 수정(§0)**: 별도 PR(#55 `fix/health-session-sync`)로 먼저 머지됐다. 세션은 `SYNCED_METRICS`(= `HEALTH_METRICS` + `SESSION_CONFIGS`)로
    스칼라와 같은 정방향/백필 경로를 탄다. 이 작업은 그 위에 rebase했고 세션 코드는 바꾸지 않는다.
11. **롤업 백필 하한**: "가장 오래된 관측일" − 1일(제안대로).
12. **weight/body-fat의 shealth 출처 47건**: 가져오지 않는다(Withings가 체성분을 담당).

## 구현 메모 (설계와 달라진 점)

**PR A — 신규 메트릭 + 롤업 + `health_user_id`**
- 롤업 config는 `rollupValueKey: "totalCalories.kcalSum"` 경로 대신 기존 필드를 재사용한다: `wrapper: "totalCalories"`, `valueKey: "kcalSum"`,
  `fetch: "dailyRollUp"`, `rollupFamily: "google-wearables"`. `filterField`는 빈 문자열이다(롤업은 `list` 필터를 쓰지 않음).
- 어댑터 `dailyRollUp`의 기존 타입은 `range.start = {year,month,day}`(평평한 형태)였는데 실측 형태는 `{ date: {...} }` 래핑이다.
  호출자는 CivilDate를 넘기고 어댑터가 감싼다. 응답 키는 `rollupDataPoints`로 확정했고 `dataPoints` 폴백은 지웠다. 라이브로 다시 확인했다(2026-11-10, 14건 + `nextPageToken`).
- `floors`는 config에 넣었지만 값 키 `countSum`은 **미검증**이다(이 기기에서는 항상 빈 응답). 키가 틀리면 파싱에서 버려지고 원문은 raw page에 남는다.
- 롤업 백필의 하한은 롤업이 아닌 메트릭의 `min(health_samples.sample_at)` − 1일이다. 다른 list 메트릭의 백필이 아직 진행 중이면
  그 하한이 더 내려갈 수 있으므로, 롤업 메트릭은 list 메트릭이 모두 끝난 뒤에만 완료로 표시한다.
- `/data-status` 복구(`recoverDay`)도 롤업 메트릭을 `dailyRollUp`으로 다시 읽는다(빈 응답은 기존 이력을 지우지 않음).
- `ensureHealthUserId`는 `syncUser`(24h 게이트)뿐 아니라 매 tick 도는 `backfillPendingConnections`에서도 호출해서, 배포 후 한 tick 안에 매핑이 채워진다. 실패하면 프로세스당 1시간에 한 번만 다시 시도한다.
- VO₂max 카드 병합은 `HealthMetricMeta.sourceKeys`(우선순위 순서)로 구현했다. 하루 단위로 첫 키의 값을 쓰고 섞지 않는다. 여행 상세 카드도 같은 매핑을 쓴다.
- 교정 스크립트는 걸음 수만 비교한다(롤업 값 키가 검증된 유일한 누적 메트릭).
- 마이그레이션 번호: 이 PR을 쓰는 동안 main에 `0043_narrative_input_hash`·`0044_wakatime_oauth`가 먼저 들어가서, `health_user_id`
  마이그레이션은 main 위로 다시 쌓으면서 `yarn db:generate`로 `0045_health_user_id`로 재생성했다(SQL은 원래 0043과 동일).

**PR B — 웹훅**
- `health_webhook_events.record_id`는 nullable + `coalesce` 표현식 인덱스 대신 `NOT NULL DEFAULT ''`로 두고 평범한 unique 인덱스를 쓴다(의미는 같다).
  행은 알림 항목이 아니라 **interval 하나당 1행**이다.
- **재전송 처리(설계보다 보수적)**: 같은 키로 다시 들어오면 `ON CONFLICT`가 행을 새로 만들지 않는다. 대신 done/failed였던 행을 `pending`으로 되돌린다.
  일별 interval("오늘의 steps")은 하루 동안 값이 바뀌며 반복해서 알림이 오는데, `DO NOTHING`이면 첫 처리 이후의 갱신을 놓치기 때문이다.
  처리 중에 재전송이 오면 `received_at > claimed_at`이 되어 완료 대신 다시 큐에 들어간다. `claimed_at`/`processed_at` 컬럼을 추가했다.
- 소비자의 `/overview` 무효화는 **과거 KST 날짜에 닿은 창만** 처리하고 **스냅샷만** 무효화한다(`invalidateRecoveredPeriods(…, { narratives: false })`).
  오늘 데이터는 활성 기간이라 precompute가 알아서 갱신한다. heart-rate 알림이 분 단위로 오므로 매번 연도 스냅샷과 Opus 내러티브를 다시 만드는 것을 피했다.
- `sleep`/`exercise` 알림도 #55 이후로는 스칼라와 같이 알림 구간만 다시 읽는다(`SYNCED_METRICS`에서 dataType으로 찾는다). sleep은 `end_time`으로 필터되므로 ±1시간 패딩으로 구간 끝을 덮는다.
- `weight` 알림 → Withings `syncUser(skipIfSyncedWithinMs: 15분)`. 같은 tick 안의 연속 알림은 (user, type) 그룹 하나로 묶이고, tick 사이에서는 Withings의 `lastSyncedAt`이 디바운스 역할을 한다.
- 서명 모드 `log-only`에서는 keyset을 가져오지 못해도 수신을 막지 않는다. 503은 `enforce`에서만 준다.
- `GOOGLE_HEALTH_WEBHOOKS_ENABLED`가 아니면 cron 작업 자체를 등록하지 않는다. 그동안 라우트는 큐에 쌓기만 한다(done/failed 행은 7일/30일 뒤 정리).
- 구독자 스크립트는 서비스 계정 대신 운영자의 gcloud 로그인 토큰을 쓰고, 프로젝트 **번호**와 `x-goog-user-project` 헤더를 사용한다. `list`로 읽기 전용 확인만 했다(현재 `{}`).
- 큐 테이블 마이그레이션도 같은 이유로 main 위에서 `yarn db:generate`로 `0046_health_webhook_events`로 재생성했다(SQL은 원래 0044와 동일).

## 범위 밖

- `skin-temperature-sensors`(v4beta), nutrition/hydration, women's health, `pairedDevices`(추가 스코프), MANUAL 구독, `reconcile` 기반 저장으로의 전환.
- 스파이크 결과를 `docs/health/google-health-spike-findings.md` §7로 옮기는 일은 구현 PR에서 한다(§3의 "sleep/exercise unfilterable",
  §4의 "dailyRollUp unverified", §6의 "floors" 기술을 함께 정정한다). CLAUDE.md의 "dailyRollUp 버킷 = Google 서버 TZ" 문장도 B2 결과로 정정한다.
