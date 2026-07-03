// TZ pinned to match production containers (TZ=Asia/Seoul).
process.env.TZ = "Asia/Seoul";

import { describe, expect, it } from "vitest";
import { buildTracks, type TrackPoint } from "./track-builder";

// Expected values derived by hand: tracks split on >30min gaps, and a group is
// kept only with ≥3 points and ≥100m haversine distance. For points on the same
// longitude, distanceM reduces to R × Δlat(rad), so this factor converts
// metres → degrees of latitude exactly.
const M_PER_DEG_LAT = (6_371_000 * Math.PI) / 180;
const BASE_LAT = 37.5;
const BASE_LON = 127.0;
const T0 = new Date(2026, 5, 1, 9, 0, 0); // 2026-06-01 09:00 KST

function tp(offsetSec: number, northM: number, altitude: number | null = null): TrackPoint {
  return {
    lat: BASE_LAT + northM / M_PER_DEG_LAT,
    lon: BASE_LON,
    altitude,
    velocity: null,
    timestamp: new Date(T0.getTime() + offsetSec * 1000),
  };
}

function at(offsetSec: number): Date {
  return new Date(T0.getTime() + offsetSec * 1000);
}

describe("buildTracks", () => {
  it("returns [] for empty input", () => {
    expect(buildTracks([])).toEqual([]);
  });

  it("returns [] for fewer than 3 points", () => {
    expect(buildTracks([tp(0, 0), tp(60, 200)])).toEqual([]);
  });

  it("discards a track shorter than 100m", () => {
    // 3 points, 25m legs → 50m total < 100m minimum.
    expect(buildTracks([tp(0, 0), tp(60, 25), tp(120, 50)])).toEqual([]);
  });

  it("builds one track and sums leg distances via haversine", () => {
    const tracks = buildTracks([tp(0, 0), tp(60, 60), tp(120, 120)]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].distanceMeters).toBe(120); // 60m + 60m
    expect(tracks[0].durationSeconds).toBe(120);
    expect(tracks[0].pointCount).toBe(3);
    expect(tracks[0].startTime).toEqual(at(0));
    expect(tracks[0].endTime).toEqual(at(120));
    expect(tracks[0].elevationGain).toBe(0);
    expect(tracks[0].elevationLoss).toBe(0);
    expect(tracks[0].points).toHaveLength(3);
  });

  it("splits into two tracks when the gap exceeds 30 minutes", () => {
    const tracks = buildTracks([
      tp(0, 0),
      tp(60, 60),
      tp(120, 120),
      tp(120 + 1801, 200), // 1801s gap → new track
      tp(120 + 1861, 260),
      tp(120 + 1921, 320),
    ]);
    expect(tracks).toHaveLength(2);
    expect(tracks[0].distanceMeters).toBe(120);
    expect(tracks[0].endTime).toEqual(at(120));
    expect(tracks[1].distanceMeters).toBe(120);
    expect(tracks[1].startTime).toEqual(at(1921));
  });

  it("keeps a gap of exactly 30 minutes in the same track", () => {
    const tracks = buildTracks([
      tp(0, 0),
      tp(60, 60),
      tp(120, 120),
      tp(120 + 1800, 200), // exactly 1800s → same track
      tp(120 + 1860, 260),
      tp(120 + 1920, 320),
    ]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].pointCount).toBe(6);
    // Legs: 60 + 60 + 80 + 60 + 60 = 320m
    expect(tracks[0].distanceMeters).toBe(320);
    expect(tracks[0].durationSeconds).toBe(2040);
  });

  it("drops a too-small group but keeps a valid one after the gap", () => {
    const tracks = buildTracks([
      tp(0, 0),
      tp(60, 200), // 2-point group → discarded
      tp(60 + 1801, 300),
      tp(60 + 1861, 360),
      tp(60 + 1921, 420),
    ]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].startTime).toEqual(at(1861));
    expect(tracks[0].pointCount).toBe(3);
  });

  it("computes elevation gain/loss over non-null altitudes, skipping nulls", () => {
    // Altitude sequence 10, 20, (null), 15, 25 → gain (20-10)+(25-15)=20, loss 5.
    const tracks = buildTracks([
      tp(0, 0, 10),
      tp(60, 30, 20),
      tp(120, 60, null),
      tp(180, 90, 15),
      tp(240, 120, 25),
    ]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].elevationGain).toBe(20);
    expect(tracks[0].elevationLoss).toBe(5);
  });
});
