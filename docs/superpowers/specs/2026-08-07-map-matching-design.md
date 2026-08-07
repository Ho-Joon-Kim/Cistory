# GPS 트랙 도로망 스냅 — Valhalla 자체 호스팅

날짜: 2026-08-07
대상: 신규 `src/lib/adapters/map-matching/`, `src/modules/location/services/route-match/`,
`src/modules/location/cron-processing.ts`, `docker-compose.yml`, 신규 마이그레이션

## 문제

`location_points`는 OwnTracks가 약 6초 간격으로 보내는 원본 GPS다. 지도에 그대로 그리면 건물을
가로지르고, 도로와 나란히 몇 미터씩 어긋나고, 정지 중 드리프트가 지그재그로 남는다. 트랙 분할
결함(2026-08-06 수정)을 고친 뒤에도 경로의 **모양**은 여전히 원본 그대로다.

### Mapbox를 쓸 수 없는 이유

Mapbox Map Matching API가 가장 손쉬운 답이지만 Mapbox Product Terms 2.10.1이
"Customer shall not export, download, cache or store results from any request to a Navigation
API"라고 못박는다. 우리는 결과를 DB에 저장해 다시 그리는 것이 목적이므로 정면으로 걸린다.
단일 사용자라는 사실은 면제 사유가 아니다 — 약관은 계정 보유자를 구속하고, 27,000건 규모의
백필은 누가 봐도 저장이며, 토큰이 정지되면 지도 렌더링까지 함께 죽는다.

따라서 자체 호스팅으로 간다.

## 결정된 사항

| 항목 | 결정 | 이유 |
|---|---|---|
| 엔진 | **Valhalla** | 타일 기반이라 지역 추가에 전체 재빌드가 없고, 메모리가 추출본 크기에 비례해 늘지 않으며, 한 인스턴스가 도보/자전거/차 costing을 모두 처리한다 |
| 추출본 | **방문 도시 bbox** | 일본 방문 9건을 위해 1.9GB 국가 PBF를 받지 않는다 |
| 저장 범위 | **스냅 경로 + 도로 메타데이터** | `/trace_attributes` 응답에 이미 들어 있어 추가 비용이 없다 |
| 매칭 단위 | **`transportation_segments`** | Valhalla는 요청마다 costing을 받는데, 세그먼트가 모드 균질 단위다 |
| 파이프라인 위치 | **일별 루프 뒤 후처리** | 단계로 넣으면 엔진 장애가 `/overview` 기간 확정을 막는다 |
| 타일 빌드 | **Valhalla 컨테이너가 자체 재빌드** | 빌드는 수십 분 CPU 작업이고, cron 컨테이너 분리의 취지를 되돌리게 된다 |

## 측정 — 현재 데이터

방문 국가: 대한민국 2,039 · 홍콩 137 · 대만 20 · 베트남 13 · 일본 9.
트랙 1,854개 / 399,538 포인트 (평균 216, 최대 6,199).

세그먼트 모드 분포 (총 4,275):

| 분류 | 모드 | 건수 |
|---|---|---|
| 도로 매칭 대상 | walking 1,678 · cycling 807 · running 461 · driving 311 · bus 65 · motorcycle 63 | **3,385** |
| `not_applicable` | subway 129 · train 94 · flying 40 | 263 |
| 제외 | stationary 592 · unknown 35 | 627 |

`stationary`는 이동이 아니므로 매칭 대상이 아니고, `unknown`은 모드를 모르니 costing을 고를 수
없다. 둘 다 행을 만들지 않는다 — `not_applicable`과 달리 "판단 자체가 성립하지 않는" 경우다.

## 설계

### 1. 어댑터 — `src/lib/adapters/map-matching/`

기존 어댑터 패턴을 따른다. 두 번째 구현이 실제로 필요해질 때까지 `interface.ts`를 만들지 않고
`valhalla.ts` 하나에 타입을 함께 둔다 (`ai/claude.ts`, `vcs/github.ts`와 같은 판단).

```ts
export interface MatchInput {
  points: Array<{ lat: number; lon: number; timestamp: Date }>;
  costing: ValhallaCosting;
}

export interface MatchResult {
  status: "matched" | "low_confidence" | "no_coverage";
  shape: Array<[number, number]> | null;  // [lat, lon]
  roadNames: string[];
  roadClasses: string[];
  confidence: number | null;
}

export function createValhallaAdapter(baseUrl: string, timeoutMs?: number): MapMatchingAdapter;
```

`POST /trace_attributes`에 `shape_match: "map_snap"`으로 보낸다. 응답의 `edges[]`에서
`names`와 `road_class`를 모으고, `matched_points[]`에서 스냅된 좌표를 얻는다.

**모드 → costing 매핑**:

| 세그먼트 모드 | Valhalla costing |
|---|---|
| walking, running | `pedestrian` |
| cycling | `bicycle` |
| driving | `auto` |
| motorcycle | `motorcycle` |
| bus | `bus` |

`motorcycle`과 `bus` costing은 Valhalla 버전에 따라 없을 수 있다. 구현 시 실제 인스턴스에
질의해 확인하고, 없으면 `auto`로 떨어뜨리되 **그 사실을 로그로 남긴다** — 조용한 폴백은
나중에 결과를 해석할 때 원인을 지운다.

### 2. 커버리지 밖 판정

Valhalla는 추출본 밖 좌표에 대해 매칭 실패를 반환한다. 이것을 엔진 오류(`failed`)와 구분해야
`no_coverage` 집계가 의미를 갖는다. 구현 시 실제 응답을 보고 판별 규칙을 정한다 — HTTP 상태와
`error_code`를 함께 봐야 할 가능성이 높다. **추측해서 문자열 매칭을 넣지 않는다.**

판별이 애매하면 보수적으로 `failed`로 둔다. `no_coverage`는 "추출본을 넓히면 살아난다"는
행동 지침이므로, 잘못 붙으면 없는 작업을 만든다.

### 3. 신뢰도 문턱

`/trace_attributes`는 `confidence_score`를 돌려준다. 문턱값은 **캘리브레이션으로 정한다** —
표본 세그먼트의 점수 분포와 실제 스냅 품질을 비교해 결정하고, 하드코딩된 추측값을 쓰지 않는다.
그때까지는 임시로 0.5를 쓰되 상수로 분리해 둔다.

### 4. 입력 크기

세그먼트 최대 6,199 포인트다. Valhalla의 `max_trace_points`(기본값은 배포마다 다르다)를 넘으면
요청이 거부된다. 두 가지를 구현 시 확인한다:

- 인스턴스의 실제 상한
- 6초 간격 원본을 그대로 보낼지, 리샘플링할지

밀집 GPS는 map matching에서 오히려 불리할 수 있다(같은 지점의 드리프트가 여러 관측으로 잡힘).
상한을 넘는 세그먼트는 시간순으로 나눠 보내고 결과를 이어 붙인다.

### 5. 스키마 — `segment_route_matches` (마이그레이션 0041)

```ts
export const segmentRouteMatches = pgTable("segment_route_matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  segmentId: uuid("segment_id").notNull()
    .references(() => transportationSegments.id, { onDelete: "cascade" }),
  matchStatus: text("match_status").notNull(),
  shape: jsonb("shape"),              // [[lat, lon], …] — matched일 때만
  roadNames: jsonb("road_names"),
  roadClasses: jsonb("road_classes"),
  confidence: doublePrecision("confidence"),
  costing: text("costing"),           // 실제로 보낸 costing (폴백 여부가 드러난다)
  tileVersion: text("tile_version").notNull(),
  matchedAt: timestamp("matched_at").notNull(),
}, (table) => [
  uniqueIndex("idx_srm_segment").on(table.segmentId),
  index("idx_srm_user_status").on(table.userId, table.matchStatus),
]);
```

**별도 테이블인 이유**: `transportation_segments`는 insights·리포트가 자주 읽고, 매칭 결과는
통째로 지우고 다시 만드는 대상이다. 지하철 매칭과 같은 재생성 방식(해당 날짜 삭제 후 재삽입)을
쓴다.

**행이 없다 = 아직 처리하지 않았다.** `not_applicable`도 행을 남기는 이유가 이것이다 —
`locationProcessingDays`가 성공한 빈 날을 기록하는 것과 같은 이유로, "처리했는데 대상이
아니었다"와 "아직 안 했다"가 구분되어야 재실행 대상을 고를 수 있다.

`tileVersion`이 있어야 "추출본을 넓힌 뒤 `no_coverage`였던 것만 다시 돌리기"가 성립한다.
값은 타일 빌드 시각의 날짜 키(`YYYY-MM-DD`)와 추출본 목록의 해시를 합친 문자열로 한다.

### 6. 파이프라인 — 후처리

`runSubwayPostProcessing`과 같은 자리에, 같은 방식으로 붙는다:

- 일별 루프가 끝난 뒤 `completedDates`에 대해 실행
- 실패해도 `location_processing_days`를 `failed`로 만들지 않는다
- 모듈 수준 단일 실행 가드

`failedStage`에 값을 **추가하지 않는다.** 매칭은 단계가 아니기 때문이다.

### 7. Valhalla 컨테이너

`docker-compose.yml`에 네 번째 서비스를 추가한다. 게시 포트 없이 내부 네트워크로만 노출하고,
타일은 이름 있는 볼륨에 둔다.

```yaml
valhalla:
  image: ghcr.io/valhalla/valhalla:latest
  volumes:
    - cistory_valhalla_tiles:/custom_files
  environment:
    - tile_urls=<bbox 추출본 목록>
    - server_threads=2
  restart: unless-stopped
```

**타일 자체 재빌드**: 컨테이너 엔트리포인트가 기동 시 타일 나이를 확인하고, 없거나 365일이
지났으면 굽고 나서 서비스를 시작한다. 이 저장소가 OSM 지하철 데이터를 연 1회(`0 3 1 1 *`)
갱신하는 것과 같은 주기다.

앱의 cron 잡은 **빌드하지 않는다.** 타일 나이와 마지막 빌드 상태를 읽어 오래됐거나 실패했으면
로그와 데이터 사용량 카드에 드러내는 역할만 한다. cron 컨테이너에 도커 소켓을 열어줄 필요가
없다는 뜻이기도 하다.

`NEXT_PUBLIC_APP_URL`처럼 `VALHALLA_URL` 환경변수를 추가하고 `.env.example`에 넣는다.
미설정 시 매칭 후처리는 조용히 건너뛴다 — 로컬 개발에서 Valhalla 없이도 나머지가 돌아야 한다.

### 8. 추출본 목록

설정 파일 하나가 bbox 목록을 갖는다. 새 도시는 여기 한 줄 추가 후 다음 재빌드에 반영된다.

| 지역 | 범위 | 대략 크기 |
|---|---|---|
| 대한민국 | 전국 (방문이 전국에 퍼져 있음) | ~200MB |
| 홍콩 | 전역 | ~30MB |
| 타이베이 | 도시권 | ~60MB |
| 다낭 + 호치민 | 도시권 | ~40MB |
| 도쿄 + 치바 | 도시권 | ~120MB |

합계 약 450MB PBF → 타일 약 1GB. 실제 크기는 구현 시 확인한다.

### 9. 지도 — 있으면 스냅, 없으면 원본

`/api/trips/[id]/route-points`와 타임라인 트랙 응답이 `matched`인 세그먼트에 대해 스냅된
`shape`를, 그 외에는 지금처럼 `location_points`를 쓴다. 토글은 넣지 않는다.

트랙 하나의 경로는 그 트랙에 속한 세그먼트들의 `shape`를 시간순으로 이어 붙여 만든다.
세그먼트 사이 빈틈(정지 구간)은 원본 좌표로 메운다.

### 10. 캘리브레이션 — 교통수단 × 도로 종류 실측

`scripts/calibrate-mode-vs-road-class.ts` — `calibrate-subway-matcher.ts` 패턴을 따른다.
설정을 수정하지 않고 표만 출력한다.

교차 집계 대상:

- 검출된 모드 × 매칭된 도로 종류 (motorway/trunk/primary/residential/footway/cycleway …)
- 각 조합의 평균·중앙 속도
- 신뢰도 점수 분포

이 표가 답해야 할 질문: **지금의 속도·위치 휴리스틱이 도로 종류와 얼마나 어긋나는가.**
`footway`에서 40km/h가 나오는 조합이 몇 건인지, `motorway`에서 5km/h가 나오는 조합이
정체인지 오매칭인지 — 분포를 보고 판단한다.

**재분류 규칙은 이 표를 본 뒤에 정한다.** 이번 범위는 측정까지다. 두 변경을 섞으면 어느 쪽이
결과를 바꿨는지 분리해 측정할 수 없다.

### 11. 백필

`scripts/backfill-route-matches.ts` — 기존 `scripts/backfill-*.ts` 패턴
(`userId` + 날짜 범위 + `--dry-run`, `scripts/lib/backfill-args.ts` 재사용).

- 대상: 도로 모드 세그먼트 3,385개
- 동시성은 Valhalla `server_threads`에 맞춘다 (기본 2)
- 행 단위 실패 격리, 실패 수가 종료 코드를 정한다
- `--dry-run`은 쓰기 없이 대상 건수와 모드별 분포만 출력한다

## 테스트

- **어댑터**: 실제 `/trace_attributes` 응답 형태를 고정한 픽스처로 shape·이름·도로 종류 추출을
  검증. 커버리지 밖 응답과 저신뢰도 응답이 각각 올바른 status가 되는지 포함. HTTP는 모킹한다
- **모드 → costing 매핑**: 각 모드가 올바른 costing으로 가는지, 미지원 costing이 `auto`로
  떨어지면서 로그가 남는지
- **status 분류**: `not_applicable` 모드가 행을 남기되 `shape`가 null인지,
  `stationary`/`unknown`이 행을 만들지 않는지
- **트랙 경로 조립**: 세그먼트 shape들이 시간순으로 이어지고, 미매칭 구간이 원본으로 메워지는지
- **입력 분할**: 상한을 넘는 세그먼트가 나뉘어 보내지고 결과가 이어 붙는지

이 저장소에는 SQL을 실제로 실행하는 테스트가 없다(별도 과제). 여기서도 순수 함수와 HTTP 모킹
범위까지만 검증한다.

## 범위 밖

- **교통수단 재분류** — 10절의 실측까지가 이번 범위다
- **고도 보정** — Valhalla가 elevation을 줄 수 있으나 `tracks.elevationGain`은 이미 다른
  경로로 채워진다. 섞지 않는다
- **경로 탐색(routing)** — 우리는 map matching만 쓴다. Valhalla가 길찾기도 하지만 용도가 없다
- **실시간 매칭** — 배치 후처리다. 대시보드가 오늘 데이터를 60초마다 폴링하지만 스냅은 다음
  후처리 때 붙는다
- **`no_coverage` 자동 확장** — 집계해서 드러내되 자동으로 추출본을 받지 않는다
- **`transportation_segments` 스키마 변경** — 매칭 결과는 전부 새 테이블에 들어간다
