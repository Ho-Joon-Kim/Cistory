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
});
