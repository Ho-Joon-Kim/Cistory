# 트랙 분할 수정 — 체류 기반 분할

날짜: 2026-08-06
대상: `src/modules/location/services/track-builder.ts`, 신규 `stay-detector.ts`

## 문제

2026-02 이후 모든 트랙이 "하루 1개, 정확히 24시간, `dominant_mode = stationary`"로 저장된다.

```
start_time          | end_time            | hours | point_count | km   | dominant_mode
2026-08-04 15:00:03 | 2026-08-05 14:59:55 | 24.0  | 13764       | 13.9 | stationary
2026-08-03 15:00:00 | 2026-08-04 14:59:52 | 24.0  | 12201       | 16.8 | stationary
```

트랙 경계인 15:00 UTC는 00:00 KST — 실제 이동이 아니라 일별 처리 창의 경계다.

### 근본 원인

`buildTracks`는 30분 시간 공백으로만 분할한다:

```ts
const TRACK_GAP_SEC = 1800; // 30 minutes — split threshold between tracks
```

OwnTracks 샘플링 밀도가 바뀌면서 이 조건이 영영 성립하지 않게 됐다:

| 시점 | 포인트/일 | 평균 간격 | 트랙/월 | 트랙당 포인트 |
|---|---|---|---|---|
| ~2026-01 | ~123 | 약 12분 | ~100 | 22~39 |
| 2026-02~ | ~14,000 | 약 6초 | ~30 | ~13,000 |

저빈도 시절에는 정지 중 자연히 30분 공백이 생겨 트랙이 갈렸다. 연속 추적에서는 공백이 없으므로 하루가 통째로 트랙 하나가 된다.

### 영향 범위

`tracks` → `transportation_segments` → 지하철 매칭, `/travel` 경로, 타임라인 트랙,
insights의 transport-modes / swimlane.

2026-06 이후 세그먼트 모드 분포에서 `stationary`가 190/487 (39%)로 최대 비중을 차지한다 — 이동
구간이 정지 구간에 잠식된 상태다.

## 별개 버그: 방문 검출 (이번 범위 아님)

측정 중 두 번째 결함을 확인했다. 연속 방문 쌍 1,474개 중 **529개(36%)가 서로 60초 이내로
붙어 있고**, 그중 248개는 중심점이 50m 이상 떨어져 있다.

```
t     | min | radius_m | moved_from_prev_m | place_name
11:29 |   3 |       66 |                   | 순남시래기 신논현역점
11:32 |   4 |       55 |               103 | 하이디라오 강남점
11:37 |  11 |       86 |               147 | 삼송빵집 신논현점
11:49 |   7 |       60 |               820 | 하이테이블 차병원사거리점
```

28분 동안 식당 4곳은 물리적으로 불가능하다. 실제로는 강남대로를 걸어간 하나의 이동이다.

원인은 `visit-detector.ts:131`의 **움직이는 중심점** 클러스터링이다:

```ts
const centerLat = sumLat / currentPoints.length;   // 점이 추가될수록 진행 방향으로 끌려감
const dist = distanceM(centerLat, centerLon, point.lat, point.lon);
if (dist <= radius) { currentPoints.push(point); ... }
```

새 클러스터는 반경 50m로 시작하는데(`dynamicRadiusM(0)`), 중심이 걷는 방향으로 함께 이동하므로
천천히 걸으면 새 점이 계속 반경 안을 통과한다. 3분(`MIN_VISIT_DURATION_SEC`)을 넘기는 순간 방문이
확정되고, 반경 이탈 → 새 클러스터 → 또 3분 → 또 방문으로 체인이 만들어진다. `mergeVisits`는 중심
간 50m 이내만 병합하므로 이 체인은 묶이지 않는다(묶여서도 안 된다 — 애초에 방문이 아니어야 한다).

**이 버그는 별도 작업으로 분리한다.** 이유:

- `buildTracks`는 방문을 참조하지 않으므로 두 버그는 독립이다.
- 함께 고치면 visits·tracks 동시 백필이 필요해 변경이 커지고, 어느 쪽이 개선을 만들었는지 분리
  측정할 수 없다.

## 설계

### 1. `stay-detector.ts` (신규, 순수 함수)

```ts
export interface StayPoint { lat: number; lon: number; timestamp: Date }
export interface StayInterval { startIndex: number; endIndex: number; startTime: Date; endTime: Date }
export interface StayOptions { radiusM: number; minDurationSec: number }

export function findStays(points: StayPoint[], options: StayOptions): StayInterval[]
```

핵심은 **고정 앵커**다. 체류는 점 `i`에서 시작해, 이후 점들이 *앵커 `i`로부터* `radiusM` 이내인
동안 지속된다 — 움직이는 중심점이 아니다. 앵커를 벗어나면 체류가 끝나고, 길이가 `minDurationSec`
이상일 때만 `StayInterval`로 확정한다.

이 성질이 걷는 사람을 따라가지 않게 만든다. 도보 4km/h로 반경 50m를 벗어나는 데 약 45초가
걸리므로 `minDurationSec` 문턱에 걸리지 않는다. 반대로 실제로 정지해 있으면 GPS 드리프트만
있으므로 앵커 반경 안에 몇 시간이고 머문다.

`velocity`는 신호로 쓰지 않는다 — 2026-07 기준 457k 포인트 중 107k(23%)만 채워져 있다.

### 2. `buildTracks` 변경

현재는 30분 공백으로만 분할한다. 변경 후에는 **30분 공백 또는 체류 구간**에서 분할한다.

- `findStays`로 체류 구간을 구한다
- 체류 구간에 속한 점은 트랙에서 제외한다 (트랙 = 이동)
- 체류 사이의 각 구간이 하나의 트랙이 된다
- 기존 필터(`MIN_TRACK_POINTS` 3, `MIN_TRACK_DISTANCE_M` 100)는 유지한다

시그니처를 `buildTracks(points, options?)`로 확장하고, 미지정 시 캘리브레이션으로 확정한 기본값을
쓴다. `visit-detector`는 이번 작업에서 수정하지 않되, 나중에 같은 `findStays`로 갈아탈 수 있도록
인터페이스를 맞춰 둔다.

### 3. 캘리브레이션

`scripts/calibrate-track-splitting.ts` — `scripts/calibrate-subway-matcher.ts` 패턴을 따른다.
스크립트는 설정을 수정하지 않고 표만 출력하며, 확정된 값은 수동으로 반영한다.

- `radiusM` × `minDurationSec` 격자 탐색
- 평가 지표:
  - 하루 트랙 수 분포
  - 트랙당 중앙 지속시간
  - `transportation_segments`의 `stationary` 비율 (현재 39%, 이동만 남으면 크게 떨어져야 함)
- 대상 구간: 2026-02-01 ~ 현재

### 4. 테스트 (TDD)

구현 전에 실패하는 테스트를 먼저 작성한다.

`stay-detector.test.ts` (신규):
- 반경 20m 안에서 3시간 정지 → 체류 1개
- 도보로 직선 이동(6초 간격, 4km/h) → 체류 0개
- 강남 걷기 케이스(중심점 103m·147m·820m 순차 이동) → 체류 0개
- 정지 → 이동 → 정지 → 체류 2개, 경계가 정확한 인덱스에 놓임

`track-builder.test.ts` (추가):
- 6초 간격 24시간 연속 데이터 → 트랙이 1개가 **아님** (이 버그를 고정하는 회귀 테스트)
- 강남 걷기 케이스 → 트랙 1개
- 반경 20m 3시간 정지만 있는 하루 → 트랙 0개
- 12분 간격 저빈도 데이터 → 기존 동작 유지 (30분 공백 경로가 여전히 작동)

### 5. 백필

`detectAndPersistTracks`는 대상 날짜의 tracks와 transportation_segments를 전부 삭제한 뒤
재삽입하므로 idempotent하다. 기존 `backfill-orchestrator.ts` /
`/api/settings/location-backfill`(SSE) 경로를 그대로 사용한다.

- 범위: 2026-02-01 ~ 현재 (샘플링이 바뀐 시점부터)
- `tracks`와 `transportation_segments`만 재생성한다. **`visits`는 건드리지 않는다**
- 세그먼트에 의존하는 지하철 매칭은 백필 후 재실행한다
- 2026-01 이전 저빈도 구간은 저빈도 테스트 통과를 확인한 뒤 재처리 여부를 결정한다

### 6. 범위 밖

- `visit-detector` 수정 (별도 작업)
- 방문이 KST 자정에 절단되는 문제 (별도 작업)
- Mapbox Map Matching (별도 작업 — 이 수정이 선행 조건)
- `transportation/detector` 튜닝 — 입력이 정상화된 뒤 재평가해 판단

## 스키마

변경 없음. 컬럼 추가·삭제 없이 기존 컬럼의 값만 정상화된다.
