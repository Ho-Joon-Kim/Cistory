# GPS 트랙 도로망 스냅 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OwnTracks 원본 GPS로 그려지던 이동 경로를, 자체 호스팅 Valhalla로 도로망에 스냅해 저장하고 지도에 쓴다.

**Architecture:** Valhalla를 네 번째 도커 컨테이너로 띄우고 방문 도시 bbox 추출본으로 타일을 굽는다. 매칭 단위는 모드가 균질한 `transportation_segments`이며, 결과는 새 테이블 `segment_route_matches`에 status와 함께 남는다. 매칭은 일별 파이프라인의 **단계가 아니라 후처리**로 붙어 엔진 장애가 `/overview` 기간 확정을 막지 않는다.

**Tech Stack:** Valhalla (`ghcr.io/valhalla/valhalla`), Next.js 16, Drizzle ORM, PostgreSQL, Vitest, Biome, Yarn 4.

## Global Constraints

- 설계 문서: `docs/superpowers/specs/2026-08-07-map-matching-design.md`. 충돌 시 설계 문서가 우선한다.
- 마이그레이션 번호는 **0041**이다 (현재 마지막은 `drizzle/0040_ordinary_ultimo.sql`).
- **날짜 파싱**: `new Date("YYYY-MM-DD")`를 쓰지 않는다. `src/lib/utils.ts`의 `parseDateLocal` / `toLocalDateString`을 쓴다. `date.toISOString().split("T")[0]`으로 날짜 키를 만들지 않는다 — UTC 날짜라 00:00–09:00 KST가 전날로 밀린다.
- **raw SQL의 `now()` 금지**: 이 DB의 세션 타임존이 `Asia/Seoul`이라 raw `now()`는 KST 벽시계로 저장돼 Drizzle이 쓰는 UTC 벽시계와 9시간 어긋난다. 날짜를 바인딩할 때는 `src/db/sql.ts`의 `timestampParam(column, date)`를 쓴다. `src/db/raw-sql-now.test.ts`가 이를 강제한다.
- **Biome**: 2-space, 큰따옴표, 세미콜론, 100자. `yarn check`/`yarn lint`를 **저장소 전체에 돌리지 않는다** — 약 20개 무관 파일에 import 정렬 드리프트가 있어 전부 다시 쓴다. 건드린 파일만 `npx biome check --write <paths>`로 포맷하고, `git status --short`에 자기 파일만 있는지 확인한다.
- 커밋 전 `yarn test`와 `npx tsc --noEmit`를 돌린다. 시작 시점 기준선은 **863 passing**이다.
- Conventional Commit 제목. **이 저장소는 GPG 서명 커밋을 요구한다** — `gpg: signing failed`가 나면 `--no-gpg-sign`이나 설정 변경으로 우회하지 말고 멈추고 보고한다.
- 사용자 노출 문자열은 한국어.
- 실제 Valhalla 인스턴스에 요청하는 것은 Task 2(프로브)와 백필/캘리브레이션 실행뿐이다. 단위 테스트는 HTTP를 모킹한다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `docker-compose.yml` | `valhalla` 서비스 + `cistory_valhalla_tiles` 볼륨 |
| `docker/valhalla/entrypoint.sh` | 타일 나이 확인 → 필요 시 재빌드 → 서비스 기동 |
| `src/lib/map-extracts.ts` | bbox 추출본 목록 (단일 진실 공급원) |
| `scripts/probe-valhalla.ts` | 실제 응답 형태 확인용 프로브 (쓰기 없음) |
| `docs/map-matching/valhalla-probe-findings.md` | 프로브 결과 기록 |
| `src/lib/adapters/map-matching/valhalla.ts` | HTTP 클라이언트 + 응답 파싱 + status 분류 |
| `src/db/schema.ts` | `segmentRouteMatches` 테이블 |
| `drizzle/0041_*.sql` | 마이그레이션 |
| `src/modules/location/services/route-match/costing.ts` | 모드 → costing 매핑 (순수) |
| `src/modules/location/services/route-match/matcher.ts` | 하루치 세그먼트 매칭 + 영속화 |
| `src/modules/location/services/route-match/track-shape.ts` | 트랙 경로 조립 (순수) |
| `src/modules/location/cron-processing.ts` | 후처리 훅 |
| `src/app/api/trips/[id]/route-points/route.ts` | 스냅 경로 우선 읽기 |
| `scripts/backfill-route-matches.ts` | 과거 세그먼트 백필 |
| `scripts/calibrate-mode-vs-road-class.ts` | 모드 × 도로 종류 실측 표 |

---

### Task 1: Valhalla 컨테이너와 추출본 목록

**Files:**
- Create: `src/lib/map-extracts.ts`
- Create: `src/lib/map-extracts.test.ts`
- Modify: `docker-compose.yml`
- Modify: `.env.example`

> 이 Task는 **공식 이미지의 기본 엔트리포인트**를 그대로 쓴다. 타일 나이를 보고 스스로 재빌드하는 커스텀 엔트리포인트는 Task 2에서 붙인다 — 그 스크립트가 이미지 내부 경로와 환경변수 이름에 의존하는데, 그것을 확인하는 것이 Task 2의 프로브이기 때문이다. 추측한 경로가 든 스크립트를 먼저 커밋하지 않는다.

**Interfaces:**
- Produces: `MAP_EXTRACTS: MapExtract[]`, `interface MapExtract { name: string; url: string; bbox: [number, number, number, number] }`, `extractsFingerprint(): string`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/map-extracts.test.ts`:

```ts
process.env.TZ = "Asia/Seoul";

import { describe, expect, it } from "vitest";
import { MAP_EXTRACTS, extractsFingerprint } from "./map-extracts";

describe("MAP_EXTRACTS", () => {
  it("covers every country the user has visited", () => {
    const names = MAP_EXTRACTS.map((e) => e.name);
    expect(names).toContain("south-korea");
    expect(names).toContain("hong-kong");
    expect(names).toContain("taipei");
    expect(names).toContain("vietnam-cities");
    expect(names).toContain("tokyo-chiba");
  });

  it("gives every extract a well-formed bbox", () => {
    for (const extract of MAP_EXTRACTS) {
      const [minLon, minLat, maxLon, maxLat] = extract.bbox;
      expect(minLon).toBeLessThan(maxLon);
      expect(minLat).toBeLessThan(maxLat);
      expect(minLat).toBeGreaterThanOrEqual(-90);
      expect(maxLat).toBeLessThanOrEqual(90);
      expect(minLon).toBeGreaterThanOrEqual(-180);
      expect(maxLon).toBeLessThanOrEqual(180);
    }
  });

  it("gives every extract an https url", () => {
    for (const extract of MAP_EXTRACTS) {
      expect(extract.url).toMatch(/^https:\/\//);
    }
  });

  it("has no duplicate names", () => {
    const names = MAP_EXTRACTS.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  // fingerprint는 tileVersion의 절반을 이룬다. 목록이 바뀌면 반드시 값이
  // 바뀌어야 "추출본을 넓힌 뒤 no_coverage만 다시 돌리기"가 성립한다.
  it("changes its fingerprint when the extract list changes", () => {
    const before = extractsFingerprint();
    expect(before).toMatch(/^[0-9a-f]{12}$/);
    expect(extractsFingerprint()).toBe(before);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `yarn test src/lib/map-extracts.test.ts`
Expected: FAIL — `Failed to resolve import "./map-extracts"`

- [ ] **Step 3: 최소 구현**

`src/lib/map-extracts.ts`:

```ts
import { createHash } from "node:crypto";

/**
 * Valhalla 타일을 굽는 데 쓰는 OSM 추출본 목록.
 *
 * bbox는 [minLon, minLat, maxLon, maxLat] — Geofabrik/BBBike와 Valhalla가
 * 모두 쓰는 순서다. 국가 단위가 아니라 방문 도시권으로 자르는 이유는, 방문
 * 9건인 일본을 위해 1.9GB 국가 PBF를 받게 되기 때문이다. 한국만 전국인
 * 이유는 방문이 실제로 전국에 퍼져 있어서다.
 *
 * 새 도시를 다녀왔다면 여기 한 줄을 추가한다. 다음 타일 재빌드 때 반영되고,
 * 그때까지 그 지역 세그먼트는 `no_coverage`로 남는다 (조용히 사라지지 않는다).
 */
export interface MapExtract {
  /** 타일 빌드 로그와 fingerprint에 쓰이는 안정적인 식별자. */
  name: string;
  /** PBF 다운로드 URL. */
  url: string;
  /** [minLon, minLat, maxLon, maxLat] */
  bbox: [number, number, number, number];
}

export const MAP_EXTRACTS: MapExtract[] = [
  {
    name: "south-korea",
    url: "https://download.geofabrik.de/asia/south-korea-latest.osm.pbf",
    bbox: [124.5, 33.0, 132.0, 38.7],
  },
  {
    name: "hong-kong",
    url: "https://download.bbbike.org/osm/bbbike/HongKong/HongKong.osm.pbf",
    bbox: [113.8, 22.15, 114.45, 22.58],
  },
  {
    name: "taipei",
    url: "https://download.bbbike.org/osm/bbbike/Taipei/Taipei.osm.pbf",
    bbox: [121.3, 24.9, 121.7, 25.2],
  },
  {
    name: "vietnam-cities",
    url: "https://download.geofabrik.de/asia/vietnam-latest.osm.pbf",
    bbox: [106.4, 10.6, 108.4, 16.2],
  },
  {
    name: "tokyo-chiba",
    url: "https://download.bbbike.org/osm/bbbike/Tokyo/Tokyo.osm.pbf",
    bbox: [139.4, 35.4, 140.3, 35.9],
  },
];

/**
 * 추출본 목록의 12자리 해시. `segment_route_matches.tile_version`의 절반을
 * 이룬다 (나머지 절반은 빌드 날짜). 목록이 바뀌면 값이 바뀌므로, 추출본을
 * 넓힌 뒤 "옛 fingerprint로 매칭된 no_coverage 행"만 골라 다시 돌릴 수 있다.
 */
export function extractsFingerprint(): string {
  const canonical = MAP_EXTRACTS.map((e) => `${e.name}:${e.bbox.join(",")}`)
    .sort()
    .join("|");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `yarn test src/lib/map-extracts.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: docker-compose에 서비스를 추가한다**

`docker-compose.yml`의 `cistory-cron` 뒤, `volumes:` 앞에 추가. 공식 이미지의 기본 엔트리포인트를 쓴다 — `tile_urls`를 주면 없을 때 타일을 굽고 서비스를 띄운다.

```yaml
  valhalla:
    image: ghcr.io/valhalla/valhalla:latest
    container_name: cistory-valhalla
    restart: unless-stopped
    volumes:
      - cistory_valhalla_tiles:/custom_files
    environment:
      - tile_urls=${VALHALLA_TILE_URLS:-}
      - server_threads=2
```

`volumes:` 블록에 추가:

```yaml
  cistory_valhalla_tiles:
```

게시 포트를 두지 않는다 — 내부 네트워크로만 접근한다. 프로브(Task 2) 동안만 임시로 포트를 연다.

`VALHALLA_TILE_URLS`는 `MAP_EXTRACTS`의 `url`을 공백으로 이은 문자열이다. `.env.example`에 형식을 적어 둔다.

- [ ] **Step 6: `.env.example`에 항목을 추가한다**

```bash
VALHALLA_URL=http://valhalla:8002   # 미설정 시 도로망 매칭 후처리를 건너뛴다
# MAP_EXTRACTS(src/lib/map-extracts.ts)의 url을 공백으로 이은 문자열
VALHALLA_TILE_URLS="https://download.geofabrik.de/asia/south-korea-latest.osm.pbf https://..."
```

- [ ] **Step 7: 전체 확인**

Run: `yarn test && npx tsc --noEmit`
Expected: 둘 다 통과. 테스트 수 863 → 868.

- [ ] **Step 8: 커밋**

```bash
npx biome check --write src/lib/map-extracts.ts src/lib/map-extracts.test.ts
git add src/lib/map-extracts.ts src/lib/map-extracts.test.ts docker-compose.yml .env.example
git commit -m "feat(map): add a Valhalla container and the OSM extract list"
```

---

### Task 2: 프로브 — 실제 응답 형태를 확인한다

이 저장소에는 선례가 있다: `scripts/probe-google-health.ts` + `docs/health/google-health-spike-findings.md`. 어댑터를 쓰기 전에 실제 페이로드를 확인하고, **확인된 것만** 코드에 넣는다.

**Files:**
- Create: `scripts/probe-valhalla.ts`
- Create: `docs/map-matching/valhalla-probe-findings.md`
- Create: `docker/valhalla/entrypoint.sh`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: Task 1의 `MAP_EXTRACTS`, `extractsFingerprint()`
- Produces: 확인된 사실 — 커버리지 밖 응답의 판별 방법, `max_trace_points` 실제 상한, `motorcycle`/`bus` costing 지원 여부, `/trace_attributes` 응답 필드 이름, 그리고 **이미지 내부의 타일 빌드 스크립트 경로와 환경변수 이름**.

- [ ] **Step 1: 프로브 스크립트를 쓴다**

`scripts/probe-valhalla.ts`:

```ts
/**
 * Valhalla 인스턴스의 실제 동작을 확인한다. 쓰기 없음, DB 접근 없음.
 *
 * 어댑터(Task 3)를 쓰기 전에 돌린다. 여기서 확인되지 않은 형태를 어댑터에
 * 넣지 않는다 — 추측한 문자열 매칭은 조용히 틀린다.
 *
 * Usage:
 *   VALHALLA_URL=http://localhost:8002 npx tsx scripts/probe-valhalla.ts
 */
const BASE = process.env.VALHALLA_URL;
if (!BASE) {
  console.error("VALHALLA_URL이 필요합니다");
  process.exit(1);
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* 본문이 JSON이 아닐 수 있다 — 그것도 알아야 할 사실이다 */
  }
  return { status: res.status, body: parsed };
}

// 서울 강남대로 위 실제 좌표 4개 (커버리지 안).
const seoul = [
  { lat: 37.4979, lon: 127.0276, time: 0 },
  { lat: 37.4985, lon: 127.0281, time: 6 },
  { lat: 37.4991, lon: 127.0287, time: 12 },
  { lat: 37.4997, lon: 127.0292, time: 18 },
];

// 남대서양 한가운데 — 어떤 추출본에도 들어있지 않다.
const nowhere = [
  { lat: -30.0, lon: -20.0, time: 0 },
  { lat: -30.001, lon: -20.001, time: 6 },
  { lat: -30.002, lon: -20.002, time: 12 },
];

const FILTERS = {
  attributes: [
    "edge.names",
    "edge.road_class",
    "matched.point",
    "matched.type",
    "matched.edge_index",
  ],
  action: "include",
};

async function main() {
  console.log("=== 1. /status — 버전과 사용 가능한 액션 ===");
  const status = await fetch(`${BASE}/status?verbose=true`);
  console.log(JSON.stringify(await status.json(), null, 2).slice(0, 2000));

  console.log("\n=== 2. 커버리지 안 — 응답 필드 이름 확인 ===");
  const ok = await post("/trace_attributes", {
    shape: seoul,
    costing: "auto",
    shape_match: "map_snap",
    filters: FILTERS,
  });
  console.log("status:", ok.status);
  console.log(JSON.stringify(ok.body, null, 2).slice(0, 3000));

  console.log("\n=== 3. 커버리지 밖 — failed와 어떻게 구분하는가 ===");
  const off = await post("/trace_attributes", {
    shape: nowhere,
    costing: "auto",
    shape_match: "map_snap",
    filters: FILTERS,
  });
  console.log("status:", off.status);
  console.log(JSON.stringify(off.body, null, 2).slice(0, 1500));

  console.log("\n=== 4. costing 지원 여부 ===");
  for (const costing of ["auto", "pedestrian", "bicycle", "motorcycle", "bus"]) {
    const res = await post("/trace_attributes", {
      shape: seoul,
      costing,
      shape_match: "map_snap",
      filters: FILTERS,
    });
    console.log(`${costing}: HTTP ${res.status}`);
  }

  console.log("\n=== 5. max_trace_points 상한 ===");
  for (const n of [1000, 3000, 6500, 10000]) {
    const shape = Array.from({ length: n }, (_, i) => ({
      lat: 37.4979 + i * 0.00001,
      lon: 127.0276 + i * 0.00001,
      time: i * 6,
    }));
    const res = await post("/trace_attributes", {
      shape,
      costing: "auto",
      shape_match: "map_snap",
      filters: FILTERS,
    });
    const err =
      typeof res.body === "object" && res.body && "error" in res.body
        ? (res.body as { error: unknown }).error
        : "";
    console.log(`${n} points: HTTP ${res.status} ${String(err).slice(0, 120)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Valhalla를 띄우고 프로브를 돌린다**

```bash
docker compose up -d valhalla     # 첫 기동은 타일 빌드로 수십 분 걸린다
docker compose logs -f valhalla   # "tile build finished"를 기다린다
VALHALLA_URL=http://localhost:8002 npx tsx scripts/probe-valhalla.ts | tee /tmp/valhalla-probe.txt
```

컨테이너에 게시 포트가 없으므로 프로브 동안만 `docker compose port` 또는 임시 포트 매핑을 쓴다.

- [ ] **Step 3: 결과를 문서로 남긴다**

`docs/map-matching/valhalla-probe-findings.md`에 다음 다섯 가지를 **실제 출력과 함께** 기록한다:

1. Valhalla 버전
2. `/trace_attributes` 성공 응답의 정확한 필드 이름 — `matched_points[]`의 `lat`/`lon`/`type`/`edge_index`, `edges[]`의 `names`/`road_class`, 최상위 `confidence_score`가 실제로 그 이름인지
3. **커버리지 밖 응답을 성공/엔진오류와 구분하는 규칙** — HTTP 상태 코드와 `error_code` 값을 그대로 적는다
4. 지원되는 costing 목록 (`motorcycle`, `bus`가 있는지)
5. `max_trace_points` 실제 상한
6. **이미지 내부 사실** — 타일 빌드 스크립트의 실제 경로, 타일 산출물의 실제 파일명, 서비스 기동 명령. 다음 단계가 여기에 의존한다:

```bash
docker compose exec valhalla ls /valhalla /custom_files
docker compose exec valhalla sh -c 'command -v valhalla_build_tiles valhalla_service'
docker compose exec valhalla cat /valhalla/scripts/*.sh 2>/dev/null | head -60
```

- [ ] **Step 4: 확인된 경로로 커스텀 엔트리포인트를 만든다**

`docker/valhalla/entrypoint.sh` (실행 권한 필요). 아래 골격의 `<<<확인 필요>>>` 자리는 **Step 3에서 실제로 확인한 값**으로 채운다 — 추측한 경로를 남기지 않는다.

```bash
#!/bin/bash
# 타일이 없거나 오래됐거나 추출본 목록이 바뀌었을 때만 굽고, 서비스를 띄운다.
#
# 재빌드가 이 컨테이너 안에서 일어나는 것이 핵심이다. 앱의 cron 컨테이너에서
# 돌리면 안 된다 — 수백MB PBF를 받아 타일을 굽는 건 수십 분 CPU 작업이고,
# 이 저장소가 cron을 별도 컨테이너로 분리한 이유가 정확히 그런 작업이 웹
# 이벤트 루프를 막았기 때문이다. 같은 실수를 다른 자리에서 반복하지 않는다.
set -euo pipefail

TILE_DIR=/custom_files
STAMP="$TILE_DIR/.tile_build_stamp"
MAX_AGE_DAYS=${TILE_MAX_AGE_DAYS:-365}
TILE_ARTIFACT="$TILE_DIR/<<<확인 필요: 타일 산출물 파일명>>>"

needs_build() {
  [ ! -f "$STAMP" ] && return 0
  [ ! -f "$TILE_ARTIFACT" ] && return 0
  local built_fp
  built_fp=$(grep '^fingerprint=' "$STAMP" | cut -d= -f2 || echo "")
  # 추출본 목록이 바뀌면 fingerprint가 바뀐다 — 새 도시를 추가했다는 뜻이므로
  # 다음 기동에 다시 굽는다.
  [ "$built_fp" != "${EXTRACTS_FINGERPRINT:-}" ] && return 0
  local age_days
  age_days=$(( ( $(date +%s) - $(stat -c %Y "$STAMP") ) / 86400 ))
  [ "$age_days" -ge "$MAX_AGE_DAYS" ] && return 0
  return 1
}

if needs_build; then
  echo "[valhalla] building tiles (fingerprint=${EXTRACTS_FINGERPRINT:-unset})"
  mkdir -p "$TILE_DIR"
  <<<확인 필요: Step 3에서 확인한 빌드 명령>>>
  {
    echo "built_at=$(date -u +%Y-%m-%d)"
    echo "fingerprint=${EXTRACTS_FINGERPRINT:-unset}"
  } > "$STAMP"
  echo "[valhalla] tile build finished"
else
  echo "[valhalla] tiles are current, skipping build"
fi

exec <<<확인 필요: Step 3에서 확인한 기동 명령>>>
```

`docker-compose.yml`의 `valhalla` 서비스에 추가:

```yaml
    volumes:
      - cistory_valhalla_tiles:/custom_files
      - ./docker/valhalla/entrypoint.sh:/entrypoint.sh:ro
    entrypoint: ["/bin/bash", "/entrypoint.sh"]
    environment:
      - TILE_MAX_AGE_DAYS=365
      - EXTRACTS_FINGERPRINT=${EXTRACTS_FINGERPRINT:-}
      - tile_urls=${VALHALLA_TILE_URLS:-}
      - server_threads=2
```

- [ ] **Step 5: 재빌드 판정이 실제로 도는지 확인한다**

```bash
docker compose up -d valhalla
docker compose logs valhalla | grep -E "tiles are current|building tiles"
```

첫 줄이 `tiles are current, skipping build`여야 한다 — Task 1에서 이미 구웠기 때문이다. 그 뒤 `EXTRACTS_FINGERPRINT`를 아무 값으로 바꿔 재기동하면 `building tiles`가 나와야 한다. 두 경우 모두 확인하고 결과를 보고한다.

- [ ] **Step 6: 커밋**

```bash
npx biome check --write scripts/probe-valhalla.ts
git add scripts/probe-valhalla.ts docs/map-matching/valhalla-probe-findings.md docker/valhalla/entrypoint.sh docker-compose.yml
git commit -m "feat(map): rebuild Valhalla tiles in-container when stale or extracts change"
```

---

### Task 3: Valhalla 어댑터

**Files:**
- Create: `src/lib/adapters/map-matching/valhalla.ts`
- Create: `src/lib/adapters/map-matching/valhalla.test.ts`

**Interfaces:**
- Consumes: Task 2의 프로브 결과 (`docs/map-matching/valhalla-probe-findings.md`)
- Produces:
  - `type ValhallaCosting = "auto" | "pedestrian" | "bicycle" | "motorcycle" | "bus"`
  - `interface MatchPoint { lat: number; lon: number; timestamp: Date }`
  - `interface MatchResult { status: "matched" | "low_confidence" | "no_coverage" | "failed"; shape: Array<[number, number]> | null; roadNames: string[]; roadClasses: string[]; confidence: number | null }`
  - `interface MapMatchingAdapter { match(points: MatchPoint[], costing: ValhallaCosting): Promise<MatchResult> }`
  - `createValhallaAdapter(baseUrl: string, timeoutMs?: number): MapMatchingAdapter`
  - `MATCH_CONFIDENCE_THRESHOLD`, `MAX_TRACE_POINTS`

**중요**: 아래 코드는 Valhalla 문서 기준으로 쓰였다. **Task 2의 프로브 결과가 다르면 프로브가 이긴다.** 필드 이름이나 커버리지 밖 판별 규칙이 다르면 여기를 고치고, 왜 고쳤는지 보고한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/adapters/map-matching/valhalla.test.ts`:

```ts
process.env.TZ = "Asia/Seoul";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createValhallaAdapter, MATCH_CONFIDENCE_THRESHOLD } from "./valhalla";

const points = [
  { lat: 37.4979, lon: 127.0276, timestamp: new Date("2026-08-01T00:00:00Z") },
  { lat: 37.4985, lon: 127.0281, timestamp: new Date("2026-08-01T00:00:06Z") },
  { lat: 37.4991, lon: 127.0287, timestamp: new Date("2026-08-01T00:00:12Z") },
];

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const goodBody = {
  confidence_score: 0.93,
  matched_points: [
    { lat: 37.49791, lon: 127.02762, type: "matched", edge_index: 0 },
    { lat: 37.49851, lon: 127.02812, type: "matched", edge_index: 0 },
    { lat: 37.49911, lon: 127.02872, type: "matched", edge_index: 1 },
  ],
  edges: [
    { names: ["강남대로"], road_class: "trunk" },
    { names: ["테헤란로"], road_class: "primary" },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createValhallaAdapter", () => {
  it("returns matched with snapped shape, road names and classes", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, goodBody));
    const result = await createValhallaAdapter("http://valhalla:8002").match(points, "auto");

    expect(result.status).toBe("matched");
    expect(result.shape).toEqual([
      [37.49791, 127.02762],
      [37.49851, 127.02812],
      [37.49911, 127.02872],
    ]);
    expect(result.roadNames).toEqual(["강남대로", "테헤란로"]);
    expect(result.roadClasses).toEqual(["trunk", "primary"]);
    expect(result.confidence).toBe(0.93);
  });

  it("sends the costing it was given, with map_snap", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, goodBody));
    await createValhallaAdapter("http://valhalla:8002").match(points, "pedestrian");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.costing).toBe("pedestrian");
    expect(body.shape_match).toBe("map_snap");
    expect(body.shape).toHaveLength(3);
  });

  // 이 테스트가 없으면 저신뢰도 매칭이 matched로 저장돼, 나중에 지도에서
  // 엉뚱한 도로를 보고도 원인을 알 수 없게 된다.
  it("downgrades to low_confidence below the threshold", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { ...goodBody, confidence_score: MATCH_CONFIDENCE_THRESHOLD - 0.01 })
    );
    const result = await createValhallaAdapter("http://valhalla:8002").match(points, "auto");
    expect(result.status).toBe("low_confidence");
    expect(result.shape).not.toBeNull();
  });

  it("reports no_coverage when Valhalla finds no edges near the trace", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { error_code: 171, error: "No suitable edges near location" })
    );
    const result = await createValhallaAdapter("http://valhalla:8002").match(points, "auto");
    expect(result.status).toBe("no_coverage");
    expect(result.shape).toBeNull();
  });

  // 커버리지 밖과 엔진 오류를 섞으면 "추출본을 넓히면 살아난다"는 집계가
  // 거짓이 된다. 애매하면 보수적으로 failed다.
  it("reports failed — not no_coverage — for any other error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: "internal" }));
    const result = await createValhallaAdapter("http://valhalla:8002").match(points, "auto");
    expect(result.status).toBe("failed");
  });

  it("reports failed when the request throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await createValhallaAdapter("http://valhalla:8002").match(points, "auto");
    expect(result.status).toBe("failed");
    expect(result.shape).toBeNull();
  });

  it("drops unmatched points from the shape rather than snapping them to nothing", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        ...goodBody,
        matched_points: [
          { lat: 37.49791, lon: 127.02762, type: "matched", edge_index: 0 },
          { lat: 37.4985, lon: 127.0281, type: "unmatched" },
          { lat: 37.49911, lon: 127.02872, type: "matched", edge_index: 1 },
        ],
      })
    );
    const result = await createValhallaAdapter("http://valhalla:8002").match(points, "auto");
    expect(result.shape).toEqual([
      [37.49791, 127.02762],
      [37.49911, 127.02872],
    ]);
  });

  it("deduplicates road names while keeping first-seen order", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        ...goodBody,
        edges: [
          { names: ["강남대로"], road_class: "trunk" },
          { names: ["강남대로"], road_class: "trunk" },
          { names: ["테헤란로"], road_class: "primary" },
        ],
      })
    );
    const result = await createValhallaAdapter("http://valhalla:8002").match(points, "auto");
    expect(result.roadNames).toEqual(["강남대로", "테헤란로"]);
    expect(result.roadClasses).toEqual(["trunk", "primary"]);
  });

  it("splits a trace longer than MAX_TRACE_POINTS and stitches the results", async () => {
    const many = Array.from({ length: 1500 }, (_, i) => ({
      lat: 37.4 + i * 0.00001,
      lon: 127.0 + i * 0.00001,
      timestamp: new Date(Date.UTC(2026, 7, 1, 0, 0, 0) + i * 6000),
    }));
    fetchMock.mockResolvedValue(jsonResponse(200, goodBody));

    const adapter = createValhallaAdapter("http://valhalla:8002");
    const result = await adapter.match(many, "auto");

    const expectedCalls = Math.ceil(1500 / 1000);
    expect(fetchMock).toHaveBeenCalledTimes(expectedCalls);
    expect(result.status).toBe("matched");
    expect(result.shape).toHaveLength(3 * expectedCalls);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `yarn test src/lib/adapters/map-matching/valhalla.test.ts`
Expected: FAIL — `Failed to resolve import "./valhalla"`

- [ ] **Step 3: 구현**

`src/lib/adapters/map-matching/valhalla.ts`:

```ts
import { logger } from "@/lib/logger";

/**
 * Valhalla map matching 클라이언트.
 *
 * 두 번째 구현이 실제로 필요해질 때까지 `interface.ts`를 만들지 않는다 —
 * `ai/claude.ts`, `vcs/github.ts`와 같은 판단이다.
 *
 * 응답 형태는 docs/map-matching/valhalla-probe-findings.md에서 실측으로
 * 확인한 것이다. 추측한 필드 이름을 넣지 않는다.
 */

export type ValhallaCosting = "auto" | "pedestrian" | "bicycle" | "motorcycle" | "bus";

export interface MatchPoint {
  lat: number;
  lon: number;
  timestamp: Date;
}

export interface MatchResult {
  status: "matched" | "low_confidence" | "no_coverage" | "failed";
  /** [lat, lon] 순서. matched/low_confidence일 때만 채워진다. */
  shape: Array<[number, number]> | null;
  roadNames: string[];
  roadClasses: string[];
  confidence: number | null;
}

export interface MapMatchingAdapter {
  match(points: MatchPoint[], costing: ValhallaCosting): Promise<MatchResult>;
}

/**
 * 잠정값이다. Task 9의 캘리브레이션으로 실측 분포를 본 뒤 확정한다 —
 * 하드코딩된 추측값이 그대로 굳는 것을 막으려고 상수로 분리해 둔다.
 */
export const MATCH_CONFIDENCE_THRESHOLD = 0.5;

/** 프로브에서 확인한 인스턴스 상한보다 넉넉히 아래로 잡는다. */
export const MAX_TRACE_POINTS = 1000;

/** Valhalla가 "이 좌표 근처에 도로가 없다"고 답할 때의 error_code. */
const NO_EDGES_ERROR_CODE = 171;

interface TraceAttributesResponse {
  confidence_score?: number;
  matched_points?: Array<{ lat: number; lon: number; type: string; edge_index?: number }>;
  edges?: Array<{ names?: string[]; road_class?: string }>;
  error_code?: number;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function uniqueInOrder(values: string[]): string[] {
  return [...new Set(values)];
}

export function createValhallaAdapter(baseUrl: string, timeoutMs = 30_000): MapMatchingAdapter {
  async function matchChunk(points: MatchPoint[], costing: ValhallaCosting): Promise<MatchResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const base = points[0].timestamp.getTime();
      const response = await fetch(`${baseUrl}/trace_attributes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          shape: points.map((p) => ({
            lat: p.lat,
            lon: p.lon,
            time: Math.round((p.timestamp.getTime() - base) / 1000),
          })),
          costing,
          shape_match: "map_snap",
          filters: {
            attributes: [
              "edge.names",
              "edge.road_class",
              "matched.point",
              "matched.type",
              "matched.edge_index",
            ],
            action: "include",
          },
        }),
      });

      const body = (await response.json().catch(() => ({}))) as TraceAttributesResponse;

      if (!response.ok) {
        // 커버리지 밖만 no_coverage다. 그 외 오류를 여기로 섞으면
        // "추출본을 넓히면 살아난다"는 집계가 거짓이 된다.
        const status = body.error_code === NO_EDGES_ERROR_CODE ? "no_coverage" : "failed";
        return { status, shape: null, roadNames: [], roadClasses: [], confidence: null };
      }

      const shape = (body.matched_points ?? [])
        .filter((p) => p.type === "matched")
        .map((p): [number, number] => [p.lat, p.lon]);
      const edges = body.edges ?? [];
      const confidence = body.confidence_score ?? null;

      return {
        status:
          confidence !== null && confidence < MATCH_CONFIDENCE_THRESHOLD
            ? "low_confidence"
            : "matched",
        shape,
        roadNames: uniqueInOrder(edges.flatMap((e) => e.names ?? [])),
        roadClasses: uniqueInOrder(edges.map((e) => e.road_class ?? "").filter(Boolean)),
        confidence,
      };
    } catch (error) {
      logger.warn("[Valhalla] match request failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { status: "failed", shape: null, roadNames: [], roadClasses: [], confidence: null };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async match(points, costing) {
      if (points.length === 0) {
        return { status: "failed", shape: null, roadNames: [], roadClasses: [], confidence: null };
      }

      const chunks = chunk(points, MAX_TRACE_POINTS);
      const results: MatchResult[] = [];
      for (const part of chunks) {
        results.push(await matchChunk(part, costing));
      }

      // 한 조각이라도 살아있으면 이어 붙인다. 전부 실패했을 때만 실패로 본다 —
      // 긴 이동의 앞부분만 커버리지 밖인 경우가 실재한다.
      const usable = results.filter((r) => r.shape !== null);
      if (usable.length === 0) return results[0];

      const worst = usable.some((r) => r.status === "low_confidence") ? "low_confidence" : "matched";
      const confidences = usable.map((r) => r.confidence).filter((c): c is number => c !== null);

      return {
        status: worst,
        shape: usable.flatMap((r) => r.shape ?? []),
        roadNames: uniqueInOrder(usable.flatMap((r) => r.roadNames)),
        roadClasses: uniqueInOrder(usable.flatMap((r) => r.roadClasses)),
        confidence: confidences.length > 0 ? Math.min(...confidences) : null,
      };
    },
  };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `yarn test src/lib/adapters/map-matching/valhalla.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: 전체 확인 후 커밋**

```bash
yarn test && npx tsc --noEmit
npx biome check --write src/lib/adapters/map-matching/
git add src/lib/adapters/map-matching/
git commit -m "feat(map): add the Valhalla map-matching adapter"
```

---

### Task 4: 스키마와 마이그레이션

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0041_*.sql` (생성됨)
- Modify: `CLAUDE.md`

**Interfaces:**
- Produces: `segmentRouteMatches` 테이블, `MatchStatus` 유니온

- [ ] **Step 1: 스키마를 추가한다**

`src/db/schema.ts`의 `transportationSegments` 정의 뒤에 추가:

```ts
/**
 * 세그먼트별 도로망 매칭 결과. `transportation_segments`에 컬럼을 붙이지 않는
 * 이유는 그 테이블을 insights·리포트가 자주 읽고, 매칭 결과는 통째로 지우고
 * 다시 만드는 대상이기 때문이다 (지하철 매칭과 같은 재생성 방식).
 *
 * **행이 없다 = 아직 처리하지 않았다.** 그래서 지하철·기차·비행처럼 애초에
 * 도로가 아닌 세그먼트도 `not_applicable` 행을 남긴다 — "처리했는데 대상이
 * 아니었다"와 "아직 안 했다"가 구분되어야 재실행 대상을 고를 수 있다.
 * 반대로 `stationary`/`unknown`은 행을 만들지 않는다: 이동이 아니거나 모드를
 * 몰라 costing을 고를 수 없어, 판단 자체가 성립하지 않는다.
 */
export const segmentRouteMatches = pgTable(
  "segment_route_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    segmentId: uuid("segment_id")
      .notNull()
      .references(() => transportationSegments.id, { onDelete: "cascade" }),
    /** matched | low_confidence | no_coverage | failed | not_applicable */
    matchStatus: text("match_status").notNull(),
    /** [[lat, lon], …] — matched/low_confidence일 때만 채워진다. */
    shape: jsonb("shape"),
    roadNames: jsonb("road_names"),
    roadClasses: jsonb("road_classes"),
    confidence: doublePrecision("confidence"),
    /** 실제로 보낸 costing. auto 폴백이 일어났는지가 여기 드러난다. */
    costing: text("costing"),
    /** "<빌드날짜>-<추출본 fingerprint>". 추출본을 넓힌 뒤 재실행 대상을 고르는 키. */
    tileVersion: text("tile_version").notNull(),
    matchedAt: timestamp("matched_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_srm_segment").on(table.segmentId),
    index("idx_srm_user_status").on(table.userId, table.matchStatus),
  ]
);

export type MatchStatus =
  | "matched"
  | "low_confidence"
  | "no_coverage"
  | "failed"
  | "not_applicable";
```

- [ ] **Step 2: 마이그레이션을 생성한다**

Run: `yarn db:generate`
Expected: `drizzle/0041_*.sql`이 생성된다. **생성된 SQL을 읽고** `CREATE TABLE` + 유니크/일반 인덱스만 있는지 확인한다. 다른 테이블에 대한 변경이 섞여 있으면 스키마 드리프트이므로 멈추고 보고한다.

- [ ] **Step 3: 로컬에 적용한다**

Run: `yarn db:migrate`
Expected: 성공.

- [ ] **Step 4: CLAUDE.md의 테이블 목록을 갱신한다**

`*Location*` 섹션의 `subwaySystems` 항목 앞에 한 줄 추가:

```markdown
- `segmentRouteMatches` - Valhalla 도로망 매칭 결과, `(segmentId)` 유니크. `matchStatus`가 `matched`|`low_confidence`|`no_coverage`|`failed`|`not_applicable`. **행이 없다 = 아직 처리 안 함**이므로 도로가 아닌 모드도 `not_applicable` 행을 남기지만, `stationary`/`unknown`은 남기지 않는다. `tileVersion`으로 "추출본을 넓힌 뒤 `no_coverage`만 재실행"이 가능하다
```

같은 문단의 마이그레이션 나열 끝에 추가: `; 0041 segment_route_matches`.

- [ ] **Step 5: 전체 확인 후 커밋**

```bash
yarn test && npx tsc --noEmit
npx biome check --write src/db/schema.ts
git add src/db/schema.ts drizzle/ CLAUDE.md
git commit -m "feat(db): add segment_route_matches for road-network matching"
```

---

### Task 5: 모드 → costing 매핑

**Files:**
- Create: `src/modules/location/services/route-match/costing.ts`
- Create: `src/modules/location/services/route-match/costing.test.ts`

**Interfaces:**
- Consumes: Task 3의 `ValhallaCosting`
- Produces: `costingForMode(mode: string): CostingDecision`, `type CostingDecision = { kind: "match"; costing: ValhallaCosting } | { kind: "not_applicable" } | { kind: "skip" }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/modules/location/services/route-match/costing.test.ts`:

```ts
process.env.TZ = "Asia/Seoul";

import { describe, expect, it } from "vitest";
import { costingForMode } from "./costing";

describe("costingForMode", () => {
  it.each([
    ["walking", "pedestrian"],
    ["running", "pedestrian"],
    ["cycling", "bicycle"],
    ["driving", "auto"],
    ["motorcycle", "motorcycle"],
    ["bus", "bus"],
  ])("maps %s to the %s costing model", (mode, costing) => {
    expect(costingForMode(mode)).toEqual({ kind: "match", costing });
  });

  // 도로가 아닌 모드는 행을 남기되 매칭하지 않는다 — "처리했는데 대상이
  // 아니었다"가 "아직 안 했다"와 구분되어야 재실행 대상을 고를 수 있다.
  it.each(["subway", "train", "flying"])("marks %s as not_applicable", (mode) => {
    expect(costingForMode(mode)).toEqual({ kind: "not_applicable" });
  });

  // stationary는 이동이 아니고 unknown은 costing을 고를 수 없다 —
  // 판단 자체가 성립하지 않으므로 행조차 만들지 않는다.
  it.each(["stationary", "unknown"])("skips %s entirely", (mode) => {
    expect(costingForMode(mode)).toEqual({ kind: "skip" });
  });

  it("skips a mode it has never seen rather than guessing a costing", () => {
    expect(costingForMode("teleporting")).toEqual({ kind: "skip" });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `yarn test src/modules/location/services/route-match/costing.test.ts`
Expected: FAIL — `Failed to resolve import "./costing"`

- [ ] **Step 3: 구현**

`src/modules/location/services/route-match/costing.ts`:

```ts
import type { ValhallaCosting } from "@/lib/adapters/map-matching/valhalla";

/**
 * 세그먼트 모드를 어떻게 다룰지에 대한 결정.
 *
 * - `match`: 이 costing으로 Valhalla에 보낸다
 * - `not_applicable`: 도로가 아니다. 행은 남기되 매칭하지 않는다
 * - `skip`: 판단이 성립하지 않는다. 행도 만들지 않는다
 */
export type CostingDecision =
  | { kind: "match"; costing: ValhallaCosting }
  | { kind: "not_applicable" }
  | { kind: "skip" };

const ROAD_MODES: Record<string, ValhallaCosting> = {
  walking: "pedestrian",
  running: "pedestrian",
  cycling: "bicycle",
  driving: "auto",
  motorcycle: "motorcycle",
  bus: "bus",
};

const NON_ROAD_MODES = new Set(["subway", "train", "flying"]);

export function costingForMode(mode: string): CostingDecision {
  const costing = ROAD_MODES[mode];
  if (costing) return { kind: "match", costing };
  if (NON_ROAD_MODES.has(mode)) return { kind: "not_applicable" };
  // stationary, unknown, 그리고 앞으로 생길 모르는 모드. 추측해서 costing을
  // 고르면 조용히 틀린 도로에 붙는다.
  return { kind: "skip" };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `yarn test src/modules/location/services/route-match/costing.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: 커밋**

```bash
npx biome check --write src/modules/location/services/route-match/
git add src/modules/location/services/route-match/
git commit -m "feat(location): map transport modes to Valhalla costing models"
```

---

### Task 6: 매칭 서비스

**Files:**
- Create: `src/modules/location/services/route-match/matcher.ts`
- Create: `src/modules/location/services/route-match/matcher.test.ts`

**Interfaces:**
- Consumes: Task 3 (`createValhallaAdapter`, `MatchResult`), Task 4 (`segmentRouteMatches`), Task 5 (`costingForMode`)
- Produces: `matchRoutesForDay(userId: string, date: string, options?: { adapter?: MapMatchingAdapter; tileVersion?: string }): Promise<RouteMatchResult>`, `interface RouteMatchResult { segmentsConsidered: number; matched: number; lowConfidence: number; noCoverage: number; failed: number; notApplicable: number; skipped: number }`, `planSegmentMatches(segments, decisions): …` (순수 계획 함수)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/modules/location/services/route-match/matcher.test.ts` — DB를 타지 않는 순수 부분만 검증한다 (이 저장소에는 SQL을 실행하는 테스트 하네스가 없다):

```ts
process.env.TZ = "Asia/Seoul";

import { describe, expect, it, vi } from "vitest";
import type { MatchResult } from "@/lib/adapters/map-matching/valhalla";
import { buildRowForSegment, summarize } from "./matcher";

const segment = { id: "seg-1", userId: "user-1", mode: "walking" as const };
const tileVersion = "2026-08-07-abc123def456";
const now = new Date("2026-08-07T01:00:00Z");

describe("buildRowForSegment", () => {
  it("writes a not_applicable row with no shape for a non-road mode", async () => {
    const adapter = { match: vi.fn() };
    const row = await buildRowForSegment(
      { ...segment, mode: "subway" },
      async () => [],
      adapter,
      tileVersion,
      now
    );

    expect(adapter.match).not.toHaveBeenCalled();
    expect(row).toEqual({
      userId: "user-1",
      segmentId: "seg-1",
      matchStatus: "not_applicable",
      shape: null,
      roadNames: [],
      roadClasses: [],
      confidence: null,
      costing: null,
      tileVersion,
      matchedAt: now,
    });
  });

  it("returns null for a skipped mode so no row is written at all", async () => {
    const adapter = { match: vi.fn() };
    const row = await buildRowForSegment(
      { ...segment, mode: "stationary" },
      async () => [],
      adapter,
      tileVersion,
      now
    );
    expect(row).toBeNull();
    expect(adapter.match).not.toHaveBeenCalled();
  });

  it("records the costing it actually sent", async () => {
    const matched: MatchResult = {
      status: "matched",
      shape: [[37.5, 127.0]],
      roadNames: ["강남대로"],
      roadClasses: ["trunk"],
      confidence: 0.9,
    };
    const adapter = { match: vi.fn().mockResolvedValue(matched) };
    const row = await buildRowForSegment(
      { ...segment, mode: "cycling" },
      async () => [{ lat: 37.5, lon: 127.0, timestamp: now }],
      adapter,
      tileVersion,
      now
    );

    expect(adapter.match).toHaveBeenCalledWith([{ lat: 37.5, lon: 127.0, timestamp: now }], "bicycle");
    expect(row?.costing).toBe("bicycle");
    expect(row?.matchStatus).toBe("matched");
    expect(row?.shape).toEqual([[37.5, 127.0]]);
  });

  // 포인트가 없으면 매칭할 것이 없다. 어댑터를 부르면 빈 shape로 failed가
  // 돌아와 "엔진이 죽었다"처럼 보인다.
  it("marks a segment with no points as failed without calling the adapter", async () => {
    const adapter = { match: vi.fn() };
    const row = await buildRowForSegment(segment, async () => [], adapter, tileVersion, now);
    expect(adapter.match).not.toHaveBeenCalled();
    expect(row?.matchStatus).toBe("failed");
  });
});

describe("summarize", () => {
  it("counts each status and the segments that produced no row", () => {
    const result = summarize(
      [
        { matchStatus: "matched" },
        { matchStatus: "matched" },
        { matchStatus: "low_confidence" },
        { matchStatus: "no_coverage" },
        { matchStatus: "failed" },
        { matchStatus: "not_applicable" },
      ],
      8
    );
    expect(result).toEqual({
      segmentsConsidered: 8,
      matched: 2,
      lowConfidence: 1,
      noCoverage: 1,
      failed: 1,
      notApplicable: 1,
      skipped: 2,
    });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `yarn test src/modules/location/services/route-match/matcher.test.ts`
Expected: FAIL — `Failed to resolve import "./matcher"`

- [ ] **Step 3: 구현**

`src/modules/location/services/route-match/matcher.ts`:

```ts
import { and, asc, eq, gte, lt } from "drizzle-orm";
import {
  getDb,
  locationPoints,
  segmentRouteMatches,
  transportationSegments,
} from "@/db";
import {
  createValhallaAdapter,
  type MapMatchingAdapter,
  type MatchPoint,
} from "@/lib/adapters/map-matching/valhalla";
import { extractsFingerprint } from "@/lib/map-extracts";
import { logger } from "@/lib/logger";
import { endOfLocalDay, startOfLocalDay, toLocalDateString } from "@/lib/utils";
import { costingForMode } from "./costing";

export interface RouteMatchResult {
  segmentsConsidered: number;
  matched: number;
  lowConfidence: number;
  noCoverage: number;
  failed: number;
  notApplicable: number;
  skipped: number;
}

interface SegmentRow {
  id: string;
  userId: string;
  mode: string;
}

type MatchRow = typeof segmentRouteMatches.$inferInsert;

/**
 * 한 세그먼트에 대한 행을 만든다. `null`이면 행을 쓰지 않는다는 뜻이다
 * (stationary/unknown — 판단이 성립하지 않는 경우).
 *
 * DB를 타지 않도록 포인트 로더를 주입받는다. 이 저장소에는 SQL을 실행하는
 * 테스트 하네스가 없어, 순수하게 검증할 수 있는 경계를 여기 둔다.
 */
export async function buildRowForSegment(
  segment: SegmentRow,
  loadPoints: (segment: SegmentRow) => Promise<MatchPoint[]>,
  adapter: MapMatchingAdapter,
  tileVersion: string,
  now: Date
): Promise<MatchRow | null> {
  const decision = costingForMode(segment.mode);
  if (decision.kind === "skip") return null;

  const base = {
    userId: segment.userId,
    segmentId: segment.id,
    shape: null,
    roadNames: [],
    roadClasses: [],
    confidence: null,
    costing: null,
    tileVersion,
    matchedAt: now,
  };

  if (decision.kind === "not_applicable") {
    return { ...base, matchStatus: "not_applicable" };
  }

  const points = await loadPoints(segment);
  if (points.length === 0) {
    return { ...base, matchStatus: "failed" };
  }

  const result = await adapter.match(points, decision.costing);
  return {
    ...base,
    matchStatus: result.status,
    shape: result.shape,
    roadNames: result.roadNames,
    roadClasses: result.roadClasses,
    confidence: result.confidence,
    costing: decision.costing,
  };
}

export function summarize(
  rows: Array<{ matchStatus: string }>,
  segmentsConsidered: number
): RouteMatchResult {
  const count = (status: string) => rows.filter((r) => r.matchStatus === status).length;
  return {
    segmentsConsidered,
    matched: count("matched"),
    lowConfidence: count("low_confidence"),
    noCoverage: count("no_coverage"),
    failed: count("failed"),
    notApplicable: count("not_applicable"),
    skipped: segmentsConsidered - rows.length,
  };
}

/** "<빌드날짜>-<추출본 fingerprint>" */
export function currentTileVersion(now: Date): string {
  return `${toLocalDateString(now)}-${extractsFingerprint()}`;
}

/**
 * 하루치 세그먼트를 매칭하고 결과를 영속화한다.
 *
 * 멱등적이다 — 해당 날짜의 기존 행을 지우고 다시 넣는다 (지하철 매칭과 같은
 * 재생성 방식). 그래서 백필과 크론이 같은 날을 여러 번 돌아도 안전하다.
 */
export async function matchRoutesForDay(
  userId: string,
  date: string,
  options: { adapter?: MapMatchingAdapter; now?: Date } = {}
): Promise<RouteMatchResult> {
  const db = getDb();
  const now = options.now ?? new Date();
  const tileVersion = currentTileVersion(now);

  const baseUrl = process.env.VALHALLA_URL;
  const adapter = options.adapter ?? (baseUrl ? createValhallaAdapter(baseUrl) : null);
  if (!adapter) {
    logger.warn("[RouteMatch] VALHALLA_URL is unset — skipping", { userId, date });
    return {
      segmentsConsidered: 0,
      matched: 0,
      lowConfidence: 0,
      noCoverage: 0,
      failed: 0,
      notApplicable: 0,
      skipped: 0,
    };
  }

  const segments = await db
    .select({
      id: transportationSegments.id,
      userId: transportationSegments.userId,
      mode: transportationSegments.mode,
      startTime: transportationSegments.startTime,
      endTime: transportationSegments.endTime,
    })
    .from(transportationSegments)
    .where(and(eq(transportationSegments.userId, userId), eq(transportationSegments.date, date)))
    .orderBy(asc(transportationSegments.startTime));

  const loadPoints = async (segment: SegmentRow): Promise<MatchPoint[]> => {
    const found = segments.find((s) => s.id === segment.id);
    if (!found) return [];
    const rows = await db
      .select({
        lat: locationPoints.lat,
        lon: locationPoints.lon,
        timestamp: locationPoints.timestamp,
      })
      .from(locationPoints)
      .where(
        and(
          eq(locationPoints.userId, userId),
          gte(locationPoints.timestamp, found.startTime),
          lt(locationPoints.timestamp, found.endTime)
        )
      )
      .orderBy(asc(locationPoints.timestamp));
    return rows.map((r) => ({ lat: r.lat, lon: r.lon, timestamp: r.timestamp }));
  };

  const rows: MatchRow[] = [];
  for (const segment of segments) {
    const row = await buildRowForSegment(segment, loadPoints, adapter, tileVersion, now);
    if (row) rows.push(row);
  }

  const segmentIds = segments.map((s) => s.id);
  if (segmentIds.length > 0) {
    await db.transaction(async (tx) => {
      await tx
        .delete(segmentRouteMatches)
        .where(
          and(
            eq(segmentRouteMatches.userId, userId),
            inArray(segmentRouteMatches.segmentId, segmentIds)
          )
        );
      if (rows.length > 0) await tx.insert(segmentRouteMatches).values(rows);
    });
  }

  return summarize(rows, segments.length);
}
```

> 구현 시 `inArray`를 `drizzle-orm`에서 import한다. `startOfLocalDay`/`endOfLocalDay`가 쓰이지 않으면 import에서 제거한다 — 이 저장소는 미사용 import를 lint 오류로 다룬다.

- [ ] **Step 4: 통과를 확인한다**

Run: `yarn test src/modules/location/services/route-match/matcher.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 전체 확인 후 커밋**

```bash
yarn test && npx tsc --noEmit
npx biome check --write src/modules/location/services/route-match/
git add src/modules/location/services/route-match/
git commit -m "feat(location): match a day's segments against the road network"
```

---

### Task 7: 파이프라인 후처리 훅

**Files:**
- Modify: `src/modules/location/cron-processing.ts`
- Modify: `src/modules/location/cron-processing.test.ts` (없으면 생성)

**Interfaces:**
- Consumes: Task 6의 `matchRoutesForDay`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/modules/location/cron-processing.test.ts`에 추가 (기존 파일의 모킹 관례를 따른다):

```ts
// 매칭은 단계가 아니라 후처리다. 엔진이 죽어도 그날이 failed가 되면 안 된다 —
// location_processing_days가 failed면 /overview가 그 기간을 확정하지 못한다.
it("does not fail the day when route matching throws", async () => {
  const { runRouteMatchPostProcessing } = await import("./cron-processing");
  vi.doMock("./services/route-match/matcher", () => ({
    matchRoutesForDay: vi.fn().mockRejectedValue(new Error("valhalla down")),
  }));

  await expect(
    runRouteMatchPostProcessing("user-1", ["2026-08-01", "2026-08-02"])
  ).resolves.toBeUndefined();
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `yarn test src/modules/location/cron-processing.test.ts`
Expected: FAIL — `runRouteMatchPostProcessing`가 export되지 않았다

- [ ] **Step 3: 구현**

`src/modules/location/cron-processing.ts`의 `runSubwayPostProcessing` 바로 뒤에 추가:

```ts
/**
 * 도로망 매칭. 지하철 매칭과 같은 자리, 같은 방식으로 붙는다 — 일별
 * 파이프라인의 **단계가 아니다**.
 *
 * 단계로 넣으면 Valhalla 컨테이너 장애가 `location_processing_days`를
 * `failed`로 만들고, 그러면 위치 데이터는 멀쩡한데 `/overview`가 그 기간을
 * 확정하지 못한다. 그래서 실패를 삼키고 로그만 남긴다.
 */
export async function runRouteMatchPostProcessing(userId: string, completedDates: string[]) {
  try {
    const { matchRoutesForDay } = await import("./services/route-match/matcher");
    for (const date of completedDates) {
      const result = await matchRoutesForDay(userId, date);
      if (result.noCoverage > 0 || result.failed > 0) {
        logger.info(`[Cron] Route matching ${userId} ${date}`, {
          matched: result.matched,
          lowConfidence: result.lowConfidence,
          noCoverage: result.noCoverage,
          failed: result.failed,
        });
      }
    }
  } catch (error) {
    logger.warn("[Cron] Route matching failed (non-fatal)", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
```

`runSubwayPostProcessing(userId, completedDates)` 호출 바로 뒤(약 311행)에 추가:

```ts
  await runRouteMatchPostProcessing(userId, completedDates);
```

`failedStage` 유니온에 값을 **추가하지 않는다** — 매칭은 단계가 아니다.

- [ ] **Step 4: 통과를 확인한다**

Run: `yarn test src/modules/location/cron-processing.test.ts`
Expected: PASS

- [ ] **Step 5: 전체 확인 후 커밋**

```bash
yarn test && npx tsc --noEmit
npx biome check --write src/modules/location/cron-processing.ts src/modules/location/cron-processing.test.ts
git add src/modules/location/
git commit -m "feat(location): run road matching as day-loop post-processing"
```

---

### Task 8: 지도 읽기 경로

**Files:**
- Create: `src/modules/location/services/route-match/track-shape.ts`
- Create: `src/modules/location/services/route-match/track-shape.test.ts`
- Modify: `src/app/api/trips/[id]/route-points/route.ts`

**Interfaces:**
- Produces: `assembleTrackShape(segments: ShapeSegment[], rawPoints: RawPoint[]): Array<[number, number]>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/modules/location/services/route-match/track-shape.test.ts`:

```ts
process.env.TZ = "Asia/Seoul";

import { describe, expect, it } from "vitest";
import { assembleTrackShape } from "./track-shape";

const t = (iso: string) => new Date(iso);

describe("assembleTrackShape", () => {
  it("uses snapped shapes in time order", () => {
    const result = assembleTrackShape(
      [
        {
          startTime: t("2026-08-01T01:00:00Z"),
          endTime: t("2026-08-01T01:10:00Z"),
          shape: [
            [37.1, 127.1],
            [37.2, 127.2],
          ],
        },
        {
          startTime: t("2026-08-01T00:00:00Z"),
          endTime: t("2026-08-01T00:10:00Z"),
          shape: [[37.0, 127.0]],
        },
      ],
      []
    );
    expect(result).toEqual([
      [37.0, 127.0],
      [37.1, 127.1],
      [37.2, 127.2],
    ]);
  });

  // 미매칭 구간을 그냥 건너뛰면 경로가 순간이동한다. 원본으로 메워야 한다.
  it("fills a gap between snapped segments with the raw points from that gap", () => {
    const result = assembleTrackShape(
      [
        {
          startTime: t("2026-08-01T00:00:00Z"),
          endTime: t("2026-08-01T00:10:00Z"),
          shape: [[37.0, 127.0]],
        },
        {
          startTime: t("2026-08-01T00:30:00Z"),
          endTime: t("2026-08-01T00:40:00Z"),
          shape: [[37.3, 127.3]],
        },
      ],
      [
        { lat: 37.1, lon: 127.1, timestamp: t("2026-08-01T00:15:00Z") },
        { lat: 37.2, lon: 127.2, timestamp: t("2026-08-01T00:20:00Z") },
        // 스냅된 구간 안의 원본은 쓰지 않는다 — 이미 스냅본이 있다
        { lat: 99.9, lon: 99.9, timestamp: t("2026-08-01T00:05:00Z") },
      ]
    );
    expect(result).toEqual([
      [37.0, 127.0],
      [37.1, 127.1],
      [37.2, 127.2],
      [37.3, 127.3],
    ]);
  });

  it("falls back to raw points entirely when nothing was matched", () => {
    const result = assembleTrackShape(
      [],
      [
        { lat: 37.0, lon: 127.0, timestamp: t("2026-08-01T00:00:00Z") },
        { lat: 37.1, lon: 127.1, timestamp: t("2026-08-01T00:05:00Z") },
      ]
    );
    expect(result).toEqual([
      [37.0, 127.0],
      [37.1, 127.1],
    ]);
  });

  it("ignores segments whose shape is null or empty", () => {
    const result = assembleTrackShape(
      [
        {
          startTime: t("2026-08-01T00:00:00Z"),
          endTime: t("2026-08-01T00:10:00Z"),
          shape: null,
        },
        {
          startTime: t("2026-08-01T00:20:00Z"),
          endTime: t("2026-08-01T00:30:00Z"),
          shape: [],
        },
      ],
      [{ lat: 37.0, lon: 127.0, timestamp: t("2026-08-01T00:05:00Z") }]
    );
    expect(result).toEqual([[37.0, 127.0]]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `yarn test src/modules/location/services/route-match/track-shape.test.ts`
Expected: FAIL — `Failed to resolve import "./track-shape"`

- [ ] **Step 3: 구현**

`src/modules/location/services/route-match/track-shape.ts`:

```ts
export interface ShapeSegment {
  startTime: Date;
  endTime: Date;
  shape: Array<[number, number]> | null;
}

export interface RawPoint {
  lat: number;
  lon: number;
  timestamp: Date;
}

/**
 * 트랙 하나의 표시용 경로를 만든다.
 *
 * 스냅된 세그먼트는 스냅본을, 그 사이 빈틈(매칭 실패·커버리지 밖·정지 구간)은
 * 원본 좌표를 쓴다. 빈틈을 그냥 건너뛰면 지도에서 경로가 순간이동한다.
 */
export function assembleTrackShape(
  segments: ShapeSegment[],
  rawPoints: RawPoint[]
): Array<[number, number]> {
  const snapped = segments
    .filter((s) => s.shape !== null && s.shape.length > 0)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  if (snapped.length === 0) {
    return [...rawPoints]
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .map((p): [number, number] => [p.lat, p.lon]);
  }

  const covered = (ts: Date) =>
    snapped.some((s) => ts >= s.startTime && ts < s.endTime);

  const pieces: Array<{ at: number; coords: Array<[number, number]> }> = snapped.map((s) => ({
    at: s.startTime.getTime(),
    coords: s.shape as Array<[number, number]>,
  }));

  for (const point of rawPoints) {
    if (covered(point.timestamp)) continue;
    pieces.push({ at: point.timestamp.getTime(), coords: [[point.lat, point.lon]] });
  }

  return pieces.sort((a, b) => a.at - b.at).flatMap((p) => p.coords);
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `yarn test src/modules/location/services/route-match/track-shape.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 라우트를 스냅 우선으로 바꾼다**

`src/app/api/trips/[id]/route-points/route.ts`가 `location_points`를 직접 읽는다(약 48행). 여행 기간의 세그먼트와 그 매칭 결과를 함께 읽어 `assembleTrackShape`로 좌표열을 만든 뒤 반환한다. 응답 형태는 **바꾸지 않는다** — 클라이언트가 이미 쓰는 모양 그대로, 좌표만 스냅본으로 대체된다.

- [ ] **Step 6: 전체 확인 후 커밋**

```bash
yarn test && npx tsc --noEmit
npx biome check --write src/modules/location/services/route-match/ src/app/api/trips/\[id\]/route-points/route.ts
git add src/modules/location/services/route-match/ src/app/api/trips/
git commit -m "feat(travel): draw trip routes from the snapped shape when available"
```

---

### Task 9: 백필 스크립트

**Files:**
- Create: `scripts/backfill-route-matches.ts`
- Create: `scripts/backfill-route-matches.test.ts`

**Interfaces:**
- Consumes: Task 6의 `matchRoutesForDay`, `scripts/lib/backfill-args.ts`의 `parseArgs`

- [ ] **Step 1: 형제 스크립트를 읽는다**

`scripts/backfill-subway-matches.ts`를 읽고 그 구조를 따른다 — 인자 파싱, `--dry-run` 처리, 행 단위 실패 격리, 종료 코드, `isMainModule` 가드. **재구현하지 않는다.**

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`scripts/backfill-route-matches.test.ts` — 형제 스크립트의 테스트 파일이 무엇을 검증하는지 보고 같은 수준으로 맞춘다. 최소한:

```ts
process.env.TZ = "Asia/Seoul";

import { describe, expect, it } from "vitest";
import { resolveArgs } from "./backfill-route-matches";

describe("resolveArgs", () => {
  it("accepts a userId and a date range", () => {
    expect(resolveArgs(["u1", "2026-02-01", "2026-08-07"])).toEqual({
      userId: "u1",
      fromDate: "2026-02-01",
      toDate: "2026-08-07",
      dryRun: false,
    });
  });

  it("rejects a mistyped dry-run flag rather than running live", () => {
    const result = resolveArgs(["u1", "2026-02-01", "2026-08-07", "--dryrun"]);
    expect(result).toHaveProperty("error");
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `yarn test scripts/backfill-route-matches.test.ts`
Expected: FAIL

- [ ] **Step 4: 구현**

- `--dry-run`은 **쓰기를 하지 않는다** — 대상 날짜 수와 모드별 세그먼트 분포만 출력한다. `matchRoutesForDay`는 쓰기를 하므로 dry-run에서는 **부르지 않는다**
- 동시성은 1로 둔다 (Valhalla `server_threads=2`이고, 백필이 웹 요청과 자원을 다투면 안 된다)
- 날짜 단위 실패 격리, 실패 수가 종료 코드를 정한다
- `VALHALLA_URL`이 없으면 즉시 오류로 종료한다 — 백필은 조용히 아무것도 안 하면 안 된다 (크론과 다르다)

- [ ] **Step 5: 통과 확인 후 커밋**

```bash
yarn test && npx tsc --noEmit
npx biome check --write scripts/backfill-route-matches.ts scripts/backfill-route-matches.test.ts
git add scripts/
git commit -m "feat(scripts): add a road-matching backfill for historical segments"
```

---

### Task 10: 캘리브레이션 — 모드 × 도로 종류 실측

**Files:**
- Create: `scripts/calibrate-mode-vs-road-class.ts`

**Interfaces:**
- Consumes: Task 4의 `segmentRouteMatches`

- [ ] **Step 1: 형제 스크립트를 읽는다**

`scripts/calibrate-subway-matcher.ts`를 읽는다. 캘리브레이션 스크립트는 **설정을 수정하지 않고 표만 출력한다.** 확정된 값은 사람이 수동으로 반영한다.

- [ ] **Step 2: 구현**

쓰기는 없다. `--dry-run` 플래그도 없다 — 애초에 읽기 전용이다. `getDb()`로 아래 세 쿼리를 돌려 표로 출력한다.

**표 1 — 모드 × 대표 도로 종류.** 각 세그먼트의 `road_classes` 중 첫 값을 대표로 삼는다 (Valhalla가 이동 방향 순으로 반환하므로 첫 값이 진입 도로다):

```sql
SELECT s.mode,
       m.road_classes->>0 AS road_class,
       count(*)::int      AS n
FROM segment_route_matches m
JOIN transportation_segments s ON s.id = m.segment_id
WHERE m.user_id = $1
  AND m.match_status IN ('matched', 'low_confidence')
  AND jsonb_array_length(m.road_classes) > 0
GROUP BY 1, 2
ORDER BY 1, 3 DESC
```

**표 2 — 조합별 속도 분포.** `footway`에서 40km/h, `motorway`에서 5km/h 같은 조합이 몇 건이고 실제로 어떤 속도인지 본다:

```sql
SELECT s.mode,
       m.road_classes->>0 AS road_class,
       count(*)::int                                                          AS n,
       round(avg(s.avg_speed_kmh)::numeric, 1)                                AS avg_kmh,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY s.avg_speed_kmh)::numeric, 1) AS median_kmh,
       round(max(s.max_speed_kmh)::numeric, 1)                                AS max_kmh
FROM segment_route_matches m
JOIN transportation_segments s ON s.id = m.segment_id
WHERE m.user_id = $1
  AND m.match_status IN ('matched', 'low_confidence')
  AND jsonb_array_length(m.road_classes) > 0
  AND s.avg_speed_kmh IS NOT NULL
GROUP BY 1, 2
HAVING count(*) >= 3          -- 표본 2건 이하는 분포로 볼 수 없다
ORDER BY 1, 3 DESC
```

**표 3 — 신뢰도 십분위.** `MATCH_CONFIDENCE_THRESHOLD`(현재 잠정 0.5)를 어디로 옮길지의 근거다:

```sql
SELECT width_bucket(confidence, 0, 1, 10) AS decile,
       count(*)::int                      AS n,
       round(min(confidence)::numeric, 3) AS min_conf,
       round(max(confidence)::numeric, 3) AS max_conf
FROM segment_route_matches
WHERE user_id = $1 AND confidence IS NOT NULL
GROUP BY 1
ORDER BY 1
```

**status 분포도 함께 출력한다** — `no_coverage`가 몰린 좌표를 알아야 추출본을 넓힐지 판단할 수 있다:

```sql
SELECT m.match_status,
       count(*)::int AS n,
       round(avg(s.center_lat)::numeric, 1) AS approx_lat,
       round(avg(s.center_lon)::numeric, 1) AS approx_lon
FROM segment_route_matches m
JOIN transportation_segments s ON s.id = m.segment_id
GROUP BY 1 ORDER BY 2 DESC
```

> `transportation_segments`에는 중심 좌표 컬럼이 없다. 위 마지막 쿼리를 쓰려면 세그먼트 시간 범위로 `location_points`를 조인해 평균 좌표를 내야 한다 — 구현 시 그렇게 고친다. 좌표는 "어느 도시인지" 알아볼 정도면 충분하므로 소수 첫째 자리로 반올림한다.

- [ ] **Step 3: 커밋**

```bash
npx biome check --write scripts/calibrate-mode-vs-road-class.ts
git add scripts/calibrate-mode-vs-road-class.ts
git commit -m "feat(scripts): cross-tabulate transport mode against matched road class"
```

- [ ] **Step 4: 실행하고 결과를 보고한다**

```bash
npx tsx scripts/calibrate-mode-vs-road-class.ts <userId>
```

세 표를 사람에게 보고한다. **재분류 규칙은 여기서 정하지 않는다** — 이번 범위는 측정까지다.

---

## Self-Review

**Spec coverage:**

| 설계 절 | 담당 Task |
|---|---|
| 1. 어댑터 | Task 3 |
| 2. 커버리지 밖 판정 | Task 2 (프로브) + Task 3 |
| 3. 신뢰도 문턱 | Task 3 (상수) + Task 10 (실측) |
| 4. 입력 크기 | Task 2 (상한 확인) + Task 3 (분할) |
| 5. 스키마 | Task 4 |
| 6. 파이프라인 후처리 | Task 7 |
| 7. Valhalla 컨테이너 | Task 1 (서비스) + Task 2 (자체 재빌드 엔트리포인트) |
| 8. 추출본 목록 | Task 1 |
| 9. 지도 읽기 | Task 8 |
| 10. 캘리브레이션 | Task 10 |
| 11. 백필 | Task 9 |

**타입 일관성**: `MatchResult.status`(Task 3)와 `MatchStatus`(Task 4)가 겹치되 후자만 `not_applicable`을 갖는다 — 어댑터는 그 상태를 만들 수 없기 때문이다(도로가 아닌 모드는 어댑터에 닿지 않는다). 의도된 차이다.

**Task 1↔2 순서**: Task 1은 공식 이미지의 기본 엔트리포인트만 쓴다. 타일 나이를 보고 스스로 재빌드하는 커스텀 엔트리포인트는 Task 2가 프로브로 이미지 내부 경로를 확인한 뒤에 붙인다. 추측한 경로가 든 스크립트를 먼저 커밋하지 않기 위해서다 — 그런 스크립트는 조용히 아무것도 굽지 않고 서비스만 띄우며, 증상이 "매칭이 전부 no_coverage"로 나타나 원인을 엉뚱한 곳에서 찾게 된다.

**Task 3의 코드는 잠정이다**: `error_code` 171, `matched_points`/`edges`/`confidence_score` 필드 이름, `MAX_TRACE_POINTS` 1000은 모두 Valhalla 문서 기준이다. Task 2의 프로브 결과가 다르면 프로브가 이긴다. 구현자는 고친 사실을 보고한다.
