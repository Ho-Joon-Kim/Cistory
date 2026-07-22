import { describe, expect, it } from "vitest";
import { analyzeMovement } from "./movement-analyzer";

// ~0.0009° latitude ≈ 100 m, so one step per 10 s ≈ 10 m/s ≈ 36 km/h (driving).
const DRIVE_STEP_LAT = 0.0009;
const STEP_SEC = 10;

interface Point {
  lat: number;
  lon: number;
  velocity: number | null;
  timestamp: Date;
}

/** Build `count` points moving north at ~36 km/h, one every 10 s. */
function drivingCluster(startLat: number, startMs: number, count: number): Point[] {
  return Array.from({ length: count }, (_, i) => ({
    lat: startLat + i * DRIVE_STEP_LAT,
    lon: 127,
    velocity: null,
    timestamp: new Date(startMs + i * STEP_SEC * 1000),
  }));
}

describe("analyzeMovement time-gap handling", () => {
  it("excludes a mid-track GPS gap from segment duration and distance", () => {
    // 31 points driving (300 s, ~3 km), 20-minute dropout with a ~1.1 km jump,
    // then 31 more points driving (300 s, ~3 km).
    const clusterA = drivingCluster(37, 0, 31);
    const gapEndMs = 300_000 + 1200_000; // 300 s of driving + 20 min gap
    const clusterB = drivingCluster(37 + 31 * DRIVE_STEP_LAT + 0.01, gapEndMs, 31);

    const segments = analyzeMovement([...clusterA, ...clusterB]);

    // Both halves are ~36 km/h driving, so they merge into a single segment.
    // Without gap exclusion the second half would be diluted to ~10 km/h
    // (4.1 km / 1500 s) and classified as a different mode.
    expect(segments).toHaveLength(1);
    expect(segments[0].mode).toBe("driving");
    // Duration counts only actual movement (2 × 300 s), not the 1200 s gap.
    expect(segments[0].durationSeconds).toBe(600);
    // Distance excludes the ~1.1 km dropout jump (2 × ~3 km only).
    expect(segments[0].distanceMeters).toBeGreaterThan(5500);
    expect(segments[0].distanceMeters).toBeLessThan(6500);
    expect(segments[0].avgSpeedKmh).toBeGreaterThan(30);
    expect(segments[0].avgSpeedKmh).toBeLessThan(42);
  });

  it("skips a leading gap so the segment starts after the dropout", () => {
    // A stray first point, a 20-minute dropout, then a normal driving cluster.
    // metrics[0] is the gap interval, which boundary detection never checks.
    const stray: Point = { lat: 36.99, lon: 127, velocity: null, timestamp: new Date(0) };
    const cluster = drivingCluster(37, 1200_000, 31);

    const segments = analyzeMovement([stray, ...cluster]);

    expect(segments).toHaveLength(1);
    expect(segments[0].startTime).toEqual(cluster[0].timestamp);
    expect(segments[0].durationSeconds).toBe(300);
    expect(segments[0].mode).toBe("driving");
  });

  it("returns no segments when the input is a single gap with no movement", () => {
    const a: Point = { lat: 37, lon: 127, velocity: null, timestamp: new Date(0) };
    const b: Point = { lat: 37.01, lon: 127, velocity: null, timestamp: new Date(1200_000) };

    expect(analyzeMovement([a, b])).toHaveLength(0);
  });

  it("keeps gap-free tracks unchanged (full duration counted)", () => {
    // 31 points walking at ~5 km/h (14 m per 10 s step).
    const points: Point[] = Array.from({ length: 31 }, (_, i) => ({
      lat: 37 + i * 0.000126,
      lon: 127,
      velocity: null,
      timestamp: new Date(i * STEP_SEC * 1000),
    }));

    const segments = analyzeMovement(points);

    expect(segments).toHaveLength(1);
    expect(segments[0].mode).toBe("walking");
    expect(segments[0].durationSeconds).toBe(300);
  });
});

describe("analyzeMovement flight-distance classification", () => {
  function highSpeedCluster(
    totalLatitudeDegrees: number,
    durationSeconds: number,
    maxSpeedKmh: number
  ): Point[] {
    const steps = 11;
    return Array.from({ length: steps + 1 }, (_, i) => ({
      lat: 37 + (totalLatitudeDegrees * i) / steps,
      lon: 127,
      velocity: maxSpeedKmh,
      timestamp: new Date((durationSeconds * i * 1000) / steps),
    }));
  }

  it("does not label a short 52km GPS jump as flying", () => {
    const [segment] = analyzeMovement(highSpeedCluster(0.468, 660, 1_901));

    expect(segment.distanceMeters).toBeGreaterThan(50_000);
    expect(segment.avgSpeedKmh).toBeGreaterThan(270);
    expect(segment.mode).not.toBe("flying");
  });

  it("keeps a sparse 172km real flight segment as flying", () => {
    const [segment] = analyzeMovement(highSpeedCluster(1.548, 1_800, 920));

    expect(segment.distanceMeters).toBeGreaterThan(170_000);
    expect(segment.mode).toBe("flying");
  });
});
