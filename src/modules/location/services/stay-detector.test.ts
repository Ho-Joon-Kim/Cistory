// TZ pinned to match production containers (TZ=Asia/Seoul).
process.env.TZ = "Asia/Seoul";

import { describe, expect, it } from "vitest";
import { distanceM } from "@/lib/geo";
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

  it("includes a point exactly at radiusM in the stay (boundary: <=, not <)", () => {
    // radiusM is derived from the actual distance between these two points, so
    // the `<= radiusM` check inside findStays is an exact floating-point tie
    // rather than a hand-picked value that could land on either side of the
    // real boundary due to haversine rounding.
    const anchor = sp(0, 0);
    const boundary = sp(300, 80);
    const radiusM = distanceM(anchor.lat, anchor.lon, boundary.lat, boundary.lon);
    const opts = { radiusM, minDurationSec: 100 };

    const stays = findStays([anchor, boundary], opts);
    expect(stays).toHaveLength(1);
    expect(stays[0].startIndex).toBe(0);
    expect(stays[0].endIndex).toBe(1);
    expect(stays[0].durationSeconds).toBe(300);
  });

  it("treats a stay lasting exactly minDurationSec as a stay (boundary: >=, not >)", () => {
    const points = [sp(0, 0), sp(300, 0)];
    const opts = { radiusM: 50, minDurationSec: 300 };

    const stays = findStays(points, opts);
    expect(stays).toHaveLength(1);
    expect(stays[0].startIndex).toBe(0);
    expect(stays[0].endIndex).toBe(1);
    expect(stays[0].durationSeconds).toBe(300);
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
