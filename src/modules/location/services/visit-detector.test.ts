// TZ pinned to match production containers (TZ=Asia/Seoul). Visit detection is
// pure Date-arithmetic, but the midnight-crossing test constructs local dates.
process.env.TZ = "Asia/Seoul";

import { describe, expect, it } from "vitest";
import {
  type DetectedVisit,
  detectAndMergeVisits,
  detectVisits,
  type LocationRow,
  mergeVisits,
} from "./visit-detector";

// Expected values derived by hand from the documented Dawarich mechanics:
// - clusters split when a point is farther than min(50m × (1 + ln(1 + hours)), 500m)
//   from the running centroid, or when the time gap exceeds 30 minutes
// - a finalized visit needs ≥2 points and ≥180s duration
// - merge requires centers ≤50m apart, gap ≤30min, and no between-point >50m
//   from the previous visit's center.

// distanceM is a pure haversine; for two points on the same longitude it reduces
// to R × Δlat(rad), so this factor converts metres → degrees of latitude exactly.
const M_PER_DEG_LAT = (6_371_000 * Math.PI) / 180;
const BASE_LAT = 37.5;
const BASE_LON = 127.0;
const T0 = new Date(2026, 5, 1, 10, 0, 0); // 2026-06-01 10:00 KST

function pt(offsetSec: number, northM = 0): LocationRow {
  return {
    lat: BASE_LAT + northM / M_PER_DEG_LAT,
    lon: BASE_LON,
    timestamp: new Date(T0.getTime() + offsetSec * 1000),
  };
}

function at(offsetSec: number): Date {
  return new Date(T0.getTime() + offsetSec * 1000);
}

function visit(startSec: number, endSec: number, northM = 0, pointCount = 2): DetectedVisit {
  return {
    centerLat: BASE_LAT + northM / M_PER_DEG_LAT,
    centerLon: BASE_LON,
    radiusM: 15,
    startTime: at(startSec),
    endTime: at(endSec),
    durationSeconds: endSec - startSec,
    pointCount,
  };
}

describe("detectVisits", () => {
  it("returns [] for empty input", () => {
    expect(detectVisits([])).toEqual([]);
  });

  it("returns [] for a single point (below 2-point minimum)", () => {
    expect(detectVisits([pt(0)])).toEqual([]);
  });

  it("accepts a stay of exactly 180s (minimum duration is inclusive)", () => {
    const visits = detectVisits([pt(0), pt(180)]);
    expect(visits).toHaveLength(1);
    expect(visits[0].durationSeconds).toBe(180);
    expect(visits[0].pointCount).toBe(2);
    expect(visits[0].startTime).toEqual(at(0));
    expect(visits[0].endTime).toEqual(at(180));
  });

  it("rejects a stay of 179s (just under the 3-minute minimum)", () => {
    expect(detectVisits([pt(0), pt(179)])).toEqual([]);
  });

  it("clamps radius to the 15m minimum for duplicate identical points", () => {
    const visits = detectVisits([pt(0), pt(60), pt(120), pt(180)]);
    expect(visits).toHaveLength(1);
    expect(visits[0].radiusM).toBe(15);
    expect(visits[0].pointCount).toBe(4);
    expect(visits[0].centerLat).toBeCloseTo(BASE_LAT, 10);
    expect(visits[0].centerLon).toBeCloseTo(BASE_LON, 10);
  });

  it("keeps a point just inside the 50m base radius in the same cluster", () => {
    // Second point: cluster duration so far is 0 → radius is exactly the 50m base.
    const visits = detectVisits([pt(0), pt(300, 49), pt(600, 49)]);
    expect(visits).toHaveLength(1);
    expect(visits[0].pointCount).toBe(3);
    expect(visits[0].durationSeconds).toBe(600);
    // Centroid is (0 + 49 + 49)/3 ≈ 32.67m north; the farthest point (the first
    // one) defines the radius.
    expect(visits[0].centerLat).toBeCloseTo(BASE_LAT + 98 / 3 / M_PER_DEG_LAT, 8);
    expect(visits[0].radiusM).toBeCloseTo(98 / 3, 1);
  });

  it("splits the cluster when a point is just beyond the 50m base radius", () => {
    // 51m > 50m base radius → first point is orphaned (single-point cluster is
    // dropped), the remaining three points form the visit at the new location.
    const visits = detectVisits([pt(0), pt(300, 51), pt(600, 51), pt(900, 51)]);
    expect(visits).toHaveLength(1);
    expect(visits[0].startTime).toEqual(at(300));
    expect(visits[0].pointCount).toBe(3);
    expect(visits[0].centerLat).toBeCloseTo(BASE_LAT + 51 / M_PER_DEG_LAT, 8);
  });

  it("splits into two visits when the time gap exceeds 30 minutes", () => {
    const visits = detectVisits([pt(0), pt(300), pt(300 + 1801), pt(300 + 1801 + 300)]);
    expect(visits).toHaveLength(2);
    expect(visits[0].endTime).toEqual(at(300));
    expect(visits[1].startTime).toEqual(at(2101));
  });

  it("keeps a gap of exactly 30 minutes in the same visit", () => {
    const visits = detectVisits([pt(0), pt(300), pt(300 + 1800), pt(300 + 1800 + 300)]);
    expect(visits).toHaveLength(1);
    expect(visits[0].pointCount).toBe(4);
    expect(visits[0].durationSeconds).toBe(2400);
  });

  it("detects a single visit spanning midnight", () => {
    const start = new Date(2026, 5, 1, 23, 50, 0); // 2026-06-01 23:50 KST
    const rows: LocationRow[] = [];
    for (let i = 0; i <= 4; i++) {
      rows.push({
        lat: BASE_LAT,
        lon: BASE_LON,
        timestamp: new Date(start.getTime() + i * 300 * 1000), // every 5 min → 00:10
      });
    }
    const visits = detectVisits(rows);
    expect(visits).toHaveLength(1);
    expect(visits[0].startTime).toEqual(new Date(2026, 5, 1, 23, 50, 0));
    expect(visits[0].endTime).toEqual(new Date(2026, 5, 2, 0, 10, 0));
    expect(visits[0].durationSeconds).toBe(1200);
  });
});

describe("mergeVisits", () => {
  it("returns a single visit unchanged", () => {
    const v = [visit(0, 300)];
    expect(mergeVisits(v, [pt(0), pt(300)])).toEqual(v);
  });

  it("merges two same-spot visits separated by a short quiet gap", () => {
    const visits = [visit(0, 300, 0, 2), visit(900, 1200, 0, 2)];
    const allPoints = [pt(0), pt(300), pt(900), pt(1200)];
    const merged = mergeVisits(visits, allPoints);
    expect(merged).toHaveLength(1);
    expect(merged[0].startTime).toEqual(at(0));
    expect(merged[0].endTime).toEqual(at(1200));
    expect(merged[0].durationSeconds).toBe(1200);
    expect(merged[0].pointCount).toBe(4);
    expect(merged[0].centerLat).toBeCloseTo(BASE_LAT, 10);
  });

  it("recomputes the merged centroid over all spanned points", () => {
    // First visit's points sit at 0m, second visit's at 30m north → merged
    // center is the mean, 15m north.
    const visits = [visit(0, 300, 0, 2), visit(900, 1200, 30, 2)];
    const allPoints = [pt(0), pt(300), pt(900, 30), pt(1200, 30)];
    const merged = mergeVisits(visits, allPoints);
    expect(merged).toHaveLength(1);
    expect(merged[0].centerLat).toBeCloseTo(BASE_LAT + 15 / M_PER_DEG_LAT, 8);
    // Each point is 15m from the merged center; MIN radius is also 15.
    expect(merged[0].radiusM).toBeCloseTo(15, 3);
  });

  it("does not merge visits whose centers are more than 50m apart", () => {
    const visits = [visit(0, 300, 0), visit(900, 1200, 51)];
    const merged = mergeVisits(visits, [pt(0), pt(300), pt(900, 51), pt(1200, 51)]);
    expect(merged).toHaveLength(2);
  });

  it("does not merge visits separated by more than 30 minutes", () => {
    const visits = [visit(0, 300, 0), visit(300 + 1801, 300 + 1801 + 300, 0)];
    const merged = mergeVisits(visits, [pt(0), pt(300), pt(2101), pt(2401)]);
    expect(merged).toHaveLength(2);
  });

  it("merges visits separated by exactly 30 minutes (gap is inclusive)", () => {
    const visits = [visit(0, 300, 0, 2), visit(300 + 1800, 300 + 1800 + 300, 0, 2)];
    const merged = mergeVisits(visits, [pt(0), pt(300), pt(2100), pt(2400)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].durationSeconds).toBe(2400);
  });

  it("does not merge when a between-point moved more than 50m away", () => {
    const visits = [visit(0, 300, 0), visit(900, 1200, 0)];
    // Point at t=600s wandered 60m from the first visit's center.
    const allPoints = [pt(0), pt(300), pt(600, 60), pt(900), pt(1200)];
    expect(mergeVisits(visits, allPoints)).toHaveLength(2);
  });

  it("merges when between-points stayed within 50m of the center", () => {
    const visits = [visit(0, 300, 0, 2), visit(900, 1200, 0, 2)];
    const allPoints = [pt(0), pt(300), pt(600, 40), pt(900), pt(1200)];
    const merged = mergeVisits(visits, allPoints);
    expect(merged).toHaveLength(1);
    // Merge recomputes over spanned points including the 40m wanderer.
    expect(merged[0].centerLat).toBeCloseTo(BASE_LAT + 8 / M_PER_DEG_LAT, 8);
  });
});

describe("detectAndMergeVisits", () => {
  it("detects two distinct visits at places 200m apart with a long gap", () => {
    const rows = [
      pt(0),
      pt(300),
      pt(600),
      // >30min gap, 200m away → separate cluster, unmergeable (gap + distance)
      pt(600 + 2000, 200),
      pt(600 + 2300, 200),
      pt(600 + 2600, 200),
    ];
    const visits = detectAndMergeVisits(rows);
    expect(visits).toHaveLength(2);
    expect(visits[0].centerLat).toBeCloseTo(BASE_LAT, 8);
    expect(visits[1].centerLat).toBeCloseTo(BASE_LAT + 200 / M_PER_DEG_LAT, 8);
    expect(visits[0].pointCount).toBe(3);
    expect(visits[1].pointCount).toBe(3);
  });
});
