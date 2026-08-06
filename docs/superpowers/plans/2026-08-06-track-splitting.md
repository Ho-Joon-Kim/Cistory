# 체류 기반 트랙 분할 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `buildTracks`가 30분 시간 공백뿐 아니라 체류 구간에서도 분할하게 하여, 하루 전체가 트랙 하나로 뭉치는 문제를 없앤다.

**Architecture:** 고정 앵커 기반 체류 검출을 순수 함수 `findStays`로 새로 만들고(`stay-detector.ts`), `buildTracks`가 체류 구간을 제외한 나머지 구간에서만 트랙을 만들도록 바꾼다. 기존 30분 공백 분할은 각 이동 구간 내부에 그대로 남는다. `visit-detector`는 건드리지 않는다.

**Tech Stack:** TypeScript 5 (strict), Vitest (node 환경, 콜로케이트 `*.test.ts`), Drizzle ORM, Biome.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-08-06-track-splitting-design.md`
- DB 스키마 변경 없음 — 마이그레이션을 생성하지 않는다.
- `src/modules/location/services/visit-detector.ts`는 이번 작업에서 수정하지 않는다.
- 거리 계산은 반드시 `@/lib/geo`의 `distanceM(lat1, lon1, lat2, lon2)`를 쓴다.
- `velocity`는 신호로 쓰지 않는다 (2026-07 기준 23%만 채워져 있음).
- 테스트 파일 첫 줄은 `process.env.TZ = "Asia/Seoul";` — 기존 `track-builder.test.ts` 규약.
- 포맷/린트는 `yarn check`로 맞춘다 (Biome: 2-space, 큰따옴표, 세미콜론, 100자).
- 커밋 제목은 Conventional Commit (`fix:`, `test:`, `feat:`, `docs:`).

---

### Task 1: `stay-detector.ts` — 고정 앵커 체류 검출

**Files:**
- Create: `src/modules/location/services/stay-detector.ts`
- Test: `src/modules/location/services/stay-detector.test.ts`

**Interfaces:**
- Consumes: `distanceM` from `@/lib/geo`
- Produces:
  - `interface StayPoint { lat: number; lon: number; timestamp: Date }`
  - `interface StayInterval { startIndex: number; endIndex: number; startTime: Date; endTime: Date; durationSeconds: number }`
  - `interface StayOptions { radiusM: number; minDurationSec: number }`
  - `const DEFAULT_STAY_OPTIONS: StayOptions`
  - `function findStays(points: StayPoint[], options?: StayOptions): StayInterval[]`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/modules/location/services/stay-detector.test.ts`:

```ts
// TZ pinned to match production containers (TZ=Asia/Seoul).
process.env.TZ = "Asia/Seoul";

import { describe, expect, it } from "vitest";
import { findStays, type StayPoint } from "./stay-detector";

// Same conversion the track-builder tests use: for points sharing a longitude,
// distanceM reduces to R × Δlat(rad), so this converts metres → degrees exactly.
const M_PER_DEG_LAT = (6_371_000 * Math.PI) / 180;
const BASE_LAT = 37.5;
const BASE_LON = 127.0;
const T0 = new Date(2026, 5, 1, 9, 0, 0); // 2026-06-01 09:00 KST

function sp(offsetSec: number, northM: number): StayPoint {
  return {
    lat: BASE_LAT + northM / M_PER_DEG_LAT,
    lon: BASE_LON,
    timestamp: new Date(T0.getTime() + offsetSec * 1000),
  };
}

const OPTS = { radiusM: 50, minDurationSec: 600 };

describe("findStays", () => {
  it("returns [] for empty input", () => {
    expect(findStays([], OPTS)).toEqual([]);
  });

  it("detects one stay when points only drift inside the radius for hours", () => {
    const points: StayPoint[] = [];
    for (let s = 0; s <= 3 * 3600; s += 6) {
      points.push(sp(s, (s / 6) % 2 === 0 ? 0 : 20)); // 0m ↔ 20m GPS drift
    }
    const stays = findStays(points, OPTS);
    expect(stays).toHaveLength(1);
    expect(stays[0].startIndex).toBe(0);
    expect(stays[0].endIndex).toBe(points.length - 1);
    expect(stays[0].durationSeconds).toBe(3 * 3600);
  });

  it("finds no stay while walking in a straight line", () => {
    // 4 km/h sampled every 6 s ≈ 6.67 m per step; the 50 m radius is crossed
    // in ~45 s, far below minDurationSec.
    const step = (4000 / 3600) * 6;
    const points: StayPoint[] = [];
    for (let i = 0; i < 300; i++) points.push(sp(i * 6, i * step));
    expect(findStays(points, OPTS)).toEqual([]);
  });

  it("finds no stay for the 강남 walk the visit detector split into four visits", () => {
    // 28 minutes covering ~1.2 km at 2.6 km/h, including two 3-minute waits at
    // crossings. The old detector emitted four "visits" 103m/147m/820m apart.
    const step = (2600 / 3600) * 6;
    const points: StayPoint[] = [];
    let t = 0;
    let north = 0;
    const walk = (count: number) => {
      for (let i = 0; i < count; i++) {
        points.push(sp(t, north));
        t += 6;
        north += step;
      }
    };
    const wait = (count: number) => {
      for (let i = 0; i < count; i++) {
        points.push(sp(t, north));
        t += 6;
      }
    };
    walk(140);
    wait(30); // 3 min
    walk(80);
    wait(30); // 3 min
    walk(60);
    expect(findStays(points, OPTS)).toEqual([]);
  });

  it("returns two stays around a movement in the middle", () => {
    const points: StayPoint[] = [];
    let t = 0;
    for (let i = 0; i < 200; i++) {
      points.push(sp(t, 0));
      t += 6;
    }
    for (let i = 1; i <= 100; i++) {
      points.push(sp(t, i * 20));
      t += 6;
    }
    for (let i = 0; i < 200; i++) {
      points.push(sp(t, 2000));
      t += 6;
    }
    const stays = findStays(points, OPTS);
    expect(stays).toHaveLength(2);
    expect(stays[0].startIndex).toBe(0);
    expect(stays[1].endIndex).toBe(points.length - 1);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `yarn test src/modules/location/services/stay-detector.test.ts`
Expected: FAIL — `Failed to resolve import "./stay-detector"`

- [ ] **Step 3: 최소 구현 작성**

`src/modules/location/services/stay-detector.ts`:

```ts
/**
 * Stay Detector
 *
 * Finds intervals where the traveller stayed put, using a FIXED anchor: a stay
 * starts at point i and continues while later points remain within `radiusM`
 * of point i — not of a running centroid.
 *
 * The fixed anchor is the whole point. `visit-detector.ts` compares each new
 * point against a centroid recomputed as points are appended, so the centre
 * drifts along with a slow walker and the cluster never breaks — a 28-minute
 * walk down 강남대로 was emitted as four separate "visits" 103m, 147m and 820m
 * apart. An anchor cannot drift, so walking always escapes it: at 4 km/h a 50m
 * radius is crossed in ~45s, far below any sane `minDurationSec`. Standing
 * still produces only GPS drift, which stays inside the radius indefinitely.
 */

import { distanceM } from "@/lib/geo";

export interface StayPoint {
  lat: number;
  lon: number;
  timestamp: Date;
}

export interface StayInterval {
  /** Index of the first point of the stay (inclusive). */
  startIndex: number;
  /** Index of the last point of the stay (inclusive). */
  endIndex: number;
  startTime: Date;
  endTime: Date;
  durationSeconds: number;
}

export interface StayOptions {
  /** A stay holds while points remain within this distance of the anchor. */
  radiusM: number;
  /** Shorter dwells are movement, not stays. */
  minDurationSec: number;
}

export const DEFAULT_STAY_OPTIONS: StayOptions = {
  radiusM: 50,
  minDurationSec: 600,
};

export function findStays(
  points: StayPoint[],
  options: StayOptions = DEFAULT_STAY_OPTIONS
): StayInterval[] {
  const { radiusM, minDurationSec } = options;
  const stays: StayInterval[] = [];

  let i = 0;
  while (i < points.length) {
    const anchor = points[i];

    let j = i + 1;
    while (
      j < points.length &&
      distanceM(anchor.lat, anchor.lon, points[j].lat, points[j].lon) <= radiusM
    ) {
      j++;
    }

    const lastIndex = j - 1;
    const durationSeconds =
      (points[lastIndex].timestamp.getTime() - anchor.timestamp.getTime()) / 1000;

    if (durationSeconds >= minDurationSec) {
      stays.push({
        startIndex: i,
        endIndex: lastIndex,
        startTime: anchor.timestamp,
        endTime: points[lastIndex].timestamp,
        durationSeconds: Math.round(durationSeconds),
      });
      i = j; // resume scanning after the stay
    } else {
      i++; // slide the anchor forward one point
    }
  }

  return stays;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `yarn test src/modules/location/services/stay-detector.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
yarn check
git add src/modules/location/services/stay-detector.ts src/modules/location/services/stay-detector.test.ts
git commit -m "feat(location): add fixed-anchor stay detection"
```

---

### Task 2: `buildTracks`가 체류 구간에서 분할하도록 변경

**Files:**
- Modify: `src/modules/location/services/track-builder.ts`
- Test: `src/modules/location/services/track-builder.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: Task 1의 `findStays`, `DEFAULT_STAY_OPTIONS`, `StayInterval`, `StayOptions`
- Produces: `function buildTracks(points: TrackPoint[], options?: BuildTracksOptions): BuiltTrack[]` — `interface BuildTracksOptions { stay?: StayOptions }`. `BuiltTrack`과 `TrackPoint`는 변경 없음.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/modules/location/services/track-builder.test.ts`의 기존 `describe("buildTracks", ...)` 블록 **끝에** 다음 테스트를 추가한다. 파일 상단의 `tp`/`at`/`M_PER_DEG_LAT` 헬퍼는 그대로 재사용한다.

```ts
  it("splits a full day of 6-second samples into per-journey tracks", () => {
    // The regression this whole change exists for: with 6-second sampling no
    // 30-minute gap ever occurs, so the old gap-only split produced exactly one
    // 24-hour track per day with dominantMode "stationary".
    const points: TrackPoint[] = [];
    let t = 0;
    const still = (metres: number, seconds: number) => {
      for (let s = 0; s < seconds; s += 6) {
        points.push(tp(t, metres));
        t += 6;
      }
    };
    const move = (fromM: number, toM: number, seconds: number) => {
      const steps = seconds / 6;
      for (let i = 1; i <= steps; i++) {
        points.push(tp(t, fromM + ((toM - fromM) * i) / steps));
        t += 6;
      }
    };

    still(0, 8 * 3600); // home
    move(0, 10_000, 40 * 60); // commute out
    still(10_000, 8 * 3600); // office
    move(10_000, 0, 40 * 60); // commute back
    still(0, 6 * 3600); // home

    const tracks = buildTracks(points);
    expect(tracks).toHaveLength(2);
    for (const track of tracks) {
      expect(track.distanceMeters).toBeGreaterThan(9_000);
      expect(track.durationSeconds).toBeLessThan(3 * 3600);
    }
  });

  it("returns no track for a day spent entirely inside the stay radius", () => {
    const points: TrackPoint[] = [];
    for (let s = 0; s < 3 * 3600; s += 6) points.push(tp(s, (s / 6) % 2 === 0 ? 0 : 20));
    expect(buildTracks(points)).toEqual([]);
  });

  it("keeps the 30-minute gap split for low-frequency historical data", () => {
    // 12-minute sampling, as OwnTracks produced before 2026-02. Consecutive
    // points are 300m apart, so no stay is ever detected and the gap rule still
    // governs: the 2560s gap splits the run in two.
    const tracks = buildTracks([
      tp(0, 0),
      tp(720, 300),
      tp(1440, 600),
      tp(4000, 900),
      tp(4720, 1200),
      tp(5440, 1500),
    ]);
    expect(tracks).toHaveLength(2);
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `yarn test src/modules/location/services/track-builder.test.ts`
Expected: FAIL — 첫 테스트가 `expected 1 to be 2` (하루가 트랙 하나로 뭉침), 두 번째가 `expected [ {...} ] to equal []`

- [ ] **Step 3: 최소 구현 작성**

`track-builder.ts` 상단 import에 추가:

```ts
import { distanceM } from "@/lib/geo";
import { DEFAULT_STAY_OPTIONS, findStays, type StayInterval, type StayOptions } from "./stay-detector";
```

`BuiltTrack` 인터페이스 아래에 옵션 타입을 추가:

```ts
export interface BuildTracksOptions {
  /** Overrides for stay detection; defaults to DEFAULT_STAY_OPTIONS. */
  stay?: StayOptions;
}
```

기존 `buildTracks` 함수 전체를 아래 네 함수로 교체한다 (`calculateElevation`과 상수는 그대로 둔다):

```ts
/** Index ranges (inclusive) that no stay covers — i.e. the moving parts. */
function movingRanges(total: number, stays: StayInterval[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let cursor = 0;

  for (const stay of stays) {
    if (stay.startIndex > cursor) ranges.push([cursor, stay.startIndex - 1]);
    cursor = stay.endIndex + 1;
  }
  if (cursor < total) ranges.push([cursor, total - 1]);

  return ranges;
}

/** Split a run of points wherever the sampling gap exceeds TRACK_GAP_SEC. */
function splitByGap(points: TrackPoint[]): TrackPoint[][] {
  if (points.length === 0) return [];

  const groups: TrackPoint[][] = [];
  let current: TrackPoint[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prev = current[current.length - 1];
    const gapSec = (points[i].timestamp.getTime() - prev.timestamp.getTime()) / 1000;

    if (gapSec > TRACK_GAP_SEC) {
      groups.push(current);
      current = [points[i]];
    } else {
      current.push(points[i]);
    }
  }
  groups.push(current);

  return groups;
}

/** Turn a point group into a track, or null when it fails the min filters. */
function finalizeTrack(group: TrackPoint[]): BuiltTrack | null {
  if (group.length < MIN_TRACK_POINTS) return null;

  let distance = 0;
  for (let i = 1; i < group.length; i++) {
    distance += distanceM(group[i - 1].lat, group[i - 1].lon, group[i].lat, group[i].lon);
  }
  if (distance < MIN_TRACK_DISTANCE_M) return null;

  const startTime = group[0].timestamp;
  const endTime = group[group.length - 1].timestamp;
  const { gain, loss } = calculateElevation(group);

  return {
    startTime,
    endTime,
    distanceMeters: Math.round(distance),
    durationSeconds: Math.round((endTime.getTime() - startTime.getTime()) / 1000),
    pointCount: group.length,
    elevationGain: gain,
    elevationLoss: loss,
    points: group,
  };
}

/**
 * Split sorted location points into movement tracks.
 *
 * Points inside a detected stay are excluded — a track is movement. What is
 * left is split further wherever the sampling gap exceeds 30 minutes, which is
 * what carries the low-frequency historical data (one point every ~12 minutes)
 * where stays never register.
 */
export function buildTracks(points: TrackPoint[], options?: BuildTracksOptions): BuiltTrack[] {
  if (points.length < MIN_TRACK_POINTS) return [];

  const stays = findStays(points, options?.stay ?? DEFAULT_STAY_OPTIONS);
  const tracks: BuiltTrack[] = [];

  for (const [from, to] of movingRanges(points.length, stays)) {
    for (const group of splitByGap(points.slice(from, to + 1))) {
      const track = finalizeTrack(group);
      if (track) tracks.push(track);
    }
  }

  return tracks;
}
```

- [ ] **Step 4: 전체 테스트가 통과하는지 확인**

Run: `yarn test src/modules/location/services/track-builder.test.ts`
Expected: PASS — 새 테스트 3개와 기존 테스트 전부. 기존 테스트는 점 간격이 25~300m라 체류가 잡히지 않으므로 동작이 바뀌지 않아야 한다.

- [ ] **Step 5: 커밋**

```bash
yarn check
git add src/modules/location/services/track-builder.ts src/modules/location/services/track-builder.test.ts
git commit -m "fix(location): split tracks on stays, not just 30-minute gaps"
```

---

### Task 3: 캘리브레이션 스크립트

**Files:**
- Create: `scripts/calibrate-track-splitting.ts`

**Interfaces:**
- Consumes: Task 1의 `findStays`/`StayOptions`, Task 2의 `buildTracks`/`BuildTracksOptions`, 기존 `detectTransportModes` (`src/modules/location/services/transportation/detector.ts`)
- Produces: 실행 가능한 스크립트만. 애플리케이션 코드가 import하지 않는다.

- [ ] **Step 1: 스크립트 작성**

`scripts/calibrate-track-splitting.ts`:

```ts
/**
 * Calibrate the stay thresholds that drive track splitting.
 *
 * Usage:
 *   npx tsx scripts/calibrate-track-splitting.ts <userId> [fromDate] [toDate]
 *   npx tsx scripts/calibrate-track-splitting.ts d3f1... 2026-02-01 2026-08-06
 *
 * The script does NOT modify any config — it prints a grid so the winning
 * values can be written into DEFAULT_STAY_OPTIONS in
 * src/modules/location/services/stay-detector.ts by hand. Re-run the location
 * backfill afterwards to relabel historical tracks.
 *
 * Headline metric is stationaryShare: before this change, `stationary`
 * accounted for 190 of 487 transportation segments (39%). Tracks are supposed
 * to be movement, so a correct configuration drives that share down.
 */

import { argv, exit } from "node:process";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

// Scripts use relative imports, not the "@/" alias — match the existing
// scripts/calibrate-subway-matcher.ts and scripts/backfill-location-heatmaps.ts.
import { and, asc, eq, gte, isNull, lt, lte, or } from "drizzle-orm";
import { getDb, getPool, locationPoints } from "../src/db";
import { endOfLocalDay, startOfLocalDay } from "../src/lib/utils";
import { buildTracks, type TrackPoint } from "../src/modules/location/services/track-builder";
import { detectTransportModes } from "../src/modules/location/services/transportation/detector";

const RADII_M = [30, 40, 50, 60, 80, 100];
const MIN_DURATIONS_SEC = [300, 450, 600, 900, 1200];

function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cursor <= end) {
    dates.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(
        cursor.getDate()
      ).padStart(2, "0")}`
    );
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  const [userId, from = "2026-02-01", to = "2026-08-06"] = argv.slice(2);
  if (!userId) {
    console.error("usage: npx tsx scripts/calibrate-track-splitting.ts <userId> [from] [to]");
    exit(1);
  }

  const db = getDb();
  const dates = dateRange(from, to);

  // Load every day's points once; the grid search is pure computation on top.
  const pointsByDate = new Map<string, TrackPoint[]>();
  for (const date of dates) {
    const rows = await db
      .select({
        lat: locationPoints.lat,
        lon: locationPoints.lon,
        altitude: locationPoints.altitude,
        velocity: locationPoints.velocity,
        timestamp: locationPoints.timestamp,
      })
      .from(locationPoints)
      .where(
        and(
          eq(locationPoints.userId, userId),
          gte(locationPoints.timestamp, startOfLocalDay(date)),
          lt(locationPoints.timestamp, endOfLocalDay(date)),
          or(isNull(locationPoints.accuracy), lte(locationPoints.accuracy, 200)),
          or(isNull(locationPoints.anomaly), eq(locationPoints.anomaly, false))
        )
      )
      .orderBy(asc(locationPoints.timestamp));

    if (rows.length > 0) pointsByDate.set(date, rows);
  }

  console.log(`days with points: ${pointsByDate.size} (${from} … ${to})\n`);
  console.log(
    ["radiusM", "minDurSec", "medTracks/day", "medTrackMin", "maxTrackH", "stationary%"].join("\t")
  );

  for (const radiusM of RADII_M) {
    for (const minDurationSec of MIN_DURATIONS_SEC) {
      const perDayCounts: number[] = [];
      const trackMinutes: number[] = [];
      let maxTrackHours = 0;
      let stationarySec = 0;
      let totalSegmentSec = 0;

      for (const dayPoints of pointsByDate.values()) {
        const tracks = buildTracks(dayPoints, { stay: { radiusM, minDurationSec } });
        perDayCounts.push(tracks.length);

        for (const track of tracks) {
          trackMinutes.push(track.durationSeconds / 60);
          maxTrackHours = Math.max(maxTrackHours, track.durationSeconds / 3600);

          for (const segment of detectTransportModes(track.points)) {
            totalSegmentSec += segment.durationSeconds;
            if (segment.mode === "stationary") stationarySec += segment.durationSeconds;
          }
        }
      }

      const stationaryPct = totalSegmentSec === 0 ? 0 : (stationarySec / totalSegmentSec) * 100;
      console.log(
        [
          radiusM,
          minDurationSec,
          median(perDayCounts),
          median(trackMinutes).toFixed(1),
          maxTrackHours.toFixed(1),
          stationaryPct.toFixed(1),
        ].join("\t")
      );
    }
  }

  await getPool().end();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await getPool().end();
  } catch {}
  exit(1);
});
```

`getPool().end()`가 없으면 pg 풀이 열린 채로 남아 스크립트가 종료되지 않는다 — 기존 두 스크립트와 동일한 규약이다.

- [ ] **Step 2: 스크립트가 실행되는지 확인**

먼저 userId를 확인한다:

```bash
psql "$DATABASE_URL" -Atc "SELECT id FROM users LIMIT 1"
```

Run: `npx tsx scripts/calibrate-track-splitting.ts <userId> 2026-07-01 2026-07-31`
Expected: 헤더 한 줄과 30줄(6 반경 × 5 지속시간)의 표. 오류 없이 종료.

- [ ] **Step 3: 커밋**

```bash
yarn check
git add scripts/calibrate-track-splitting.ts
git commit -m "test(location): add track-splitting threshold calibration script"
```

---

### Task 4: 기본 임계값 확정

**Files:**
- Modify: `src/modules/location/services/stay-detector.ts` (`DEFAULT_STAY_OPTIONS`만)

**Interfaces:**
- Consumes: Task 3 스크립트의 출력
- Produces: 확정된 `DEFAULT_STAY_OPTIONS` 값. 시그니처는 변하지 않는다.

- [ ] **Step 1: 전 구간 캘리브레이션 실행**

Run: `npx tsx scripts/calibrate-track-splitting.ts <userId> 2026-02-01 2026-08-06 | tee /tmp/track-calibration.tsv`

- [ ] **Step 2: 승자 선택**

출력에서 다음을 모두 만족하는 행 중 `stationary%`가 가장 낮은 것을 고른다:

- `maxTrackH` < 6 — 6시간 넘는 트랙이 하나도 없어야 한다 (하루 단위로 뭉치는 증상의 잔재)
- `medTracks/day`가 2~12 사이 — 하루 이동 횟수로 그럴듯한 범위
- `medTrackMin` > 5 — 중앙값이 이보다 짧으면 트랙이 과하게 잘린 것

동률이면 `radiusM`이 큰 쪽(GPS 드리프트에 관대), 그다음 `minDurationSec`이 작은 쪽을 고른다.

- [ ] **Step 3: 값 반영**

`stay-detector.ts`의 `DEFAULT_STAY_OPTIONS`를 승자 값으로 바꾸고, 근거를 주석으로 남긴다:

```ts
// Calibrated 2026-08-06 over 2026-02-01…2026-08-06 with
// scripts/calibrate-track-splitting.ts: lowest stationary segment share among
// configurations with no track over 6 hours. See
// docs/superpowers/specs/2026-08-06-track-splitting-design.md.
export const DEFAULT_STAY_OPTIONS: StayOptions = {
  radiusM: <승자 값>,
  minDurationSec: <승자 값>,
};
```

- [ ] **Step 4: 테스트가 여전히 통과하는지 확인**

Run: `yarn test src/modules/location/services/`
Expected: PASS.

Task 1의 테스트는 전부 `OPTS`를 명시적으로 넘기므로 기본값과 무관하다. Task 2의 세 테스트는 기본값을 쓰지만 격자 전 범위(반경 30~100m, 지속 300~1200s)에서 결과가 같도록 설계했다 — 정지 구간은 3~8시간이라 어떤 `minDurationSec`도 넘고, 이동은 15km/h라 어떤 반경도 수십 초 만에 벗어나며, 저빈도 데이터는 점 간격 300m로 최대 반경조차 넘는다. 그래도 깨진다면 승자 값이 이 범위 밖이라는 뜻이므로, 값을 다시 확인하고 해당 테스트에 옵션을 명시적으로 넘긴다.

- [ ] **Step 5: 커밋**

```bash
yarn check
git add src/modules/location/services/stay-detector.ts
git commit -m "fix(location): calibrate stay thresholds against 2026-02..08 data"
```

---

### Task 5: 전체 검증과 백필

**Files:**
- 코드 변경 없음. 검증과 데이터 재생성만.

**Interfaces:**
- Consumes: Task 1~4의 결과
- Produces: 재생성된 `tracks` / `transportation_segments`, 재실행된 지하철 매칭

- [ ] **Step 1: 전체 테스트·린트·빌드**

```bash
yarn test
yarn lint
yarn build
```

Expected: 셋 다 통과. `src/app/api/_routes-import.test.ts`가 라우트 import 붕괴를 함께 잡아준다.

- [ ] **Step 2: 백필 드라이런**

`/api/settings/location-backfill`의 GET(드라이런)으로 대상 일자 수를 확인한다:

```bash
curl -s -b "$COOKIE" "$NEXT_PUBLIC_APP_URL/api/settings/location-backfill?from=2026-02-01&to=2026-08-06" | head -40
```

Expected: 2026-02-01 이후 일자 목록. 예상 일수(약 187일)와 크게 다르면 멈추고 원인을 확인한다.

- [ ] **Step 3: 백필 실행**

같은 엔드포인트의 POST(SSE)로 재처리한다. `detectAndPersistTracks`가 대상 일자의 tracks와 transportation_segments를 삭제 후 재삽입하므로 재실행해도 안전하다. `visits`는 건드리지 않는다.

- [ ] **Step 4: 결과 검증**

```sql
-- 하루 1개/24시간 트랙이 사라졌는가
SELECT to_char(date_trunc('month', start_time),'YYYY-MM') AS month,
       count(*) AS tracks,
       round(avg(point_count)) AS avg_pts,
       max(round((duration_seconds/3600.0)::numeric,1)) AS max_hours
FROM tracks WHERE start_time >= '2026-02-01' GROUP BY 1 ORDER BY 1;

-- stationary 비중이 39%에서 내려왔는가
SELECT mode, count(*), round(avg(duration_seconds)/60) AS avg_min
FROM transportation_segments WHERE start_time >= '2026-06-01' GROUP BY 1 ORDER BY 2 DESC;
```

Expected: `max_hours` < 6, 월 트랙 수가 30에서 크게 증가, `stationary`가 더 이상 최다 모드가 아님.

- [ ] **Step 5: 지하철 매칭 재실행**

세그먼트가 새로 만들어졌으므로 `/api/settings/subway-match-backfill`을 다시 돌린다.

- [ ] **Step 6: 커밋 및 PR**

```bash
git add -A
git commit -m "fix(location): backfill tracks with stay-based splitting"
git push -u origin fix/track-splitting-stay-detection
```

---

## Self-Review

**스펙 커버리지**

| 스펙 섹션 | 담당 태스크 |
|---|---|
| 1. `stay-detector.ts` 고정 앵커 | Task 1 |
| 2. `buildTracks` 변경 | Task 2 |
| 3. 캘리브레이션 | Task 3, 4 |
| 4. 테스트 (TDD) | Task 1, 2 |
| 5. 백필 | Task 5 |
| 6. 범위 밖 | Global Constraints에 `visit-detector` 금지 명시 |

**타입 일관성** — `StayPoint`/`StayInterval`/`StayOptions`/`DEFAULT_STAY_OPTIONS`/`findStays`는 Task 1에서 정의되고 Task 2·3에서 같은 이름·시그니처로 쓰인다. `TrackPoint`는 `StayPoint`의 필드를 모두 포함하므로 `findStays(points)`에 그대로 넘어간다. `BuildTracksOptions.stay`는 Task 2에서 정의되고 Task 3 스크립트가 같은 형태로 넘긴다.

**플레이스홀더** — Task 4 Step 3의 `<승자 값>`은 의도된 것으로, Step 2의 선택 규칙이 결정한다. 그 외에 미확정 항목은 없다.
