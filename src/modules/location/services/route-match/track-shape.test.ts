process.env.TZ = "Asia/Seoul";

import { describe, expect, it } from "vitest";
import { parseTravelRoute } from "@/modules/travel/hooks";
import { assembleTrackShape } from "./track-shape";

const at = (minute: number) => new Date(Date.UTC(2026, 6, 15, 0, minute));
const epoch = (minute: number) => at(minute).getTime();
// Second-precision helpers for tests that need to control gaps relative to
// MAX_SHAPE_GAP_MS (30s) — the minute-based helpers above can't express that.
const atSec = (totalSeconds: number) => new Date(Date.UTC(2026, 6, 15, 0, 0, totalSeconds));
const epochSec = (totalSeconds: number) => atSec(totalSeconds).getTime();

function raw(minute: number, lat = 37 + minute / 1000) {
  return { lat, lon: 127, accuracy: 10, timestamp: at(minute) };
}

function rawSec(totalSeconds: number, lat: number) {
  return { lat, lon: 127, accuracy: 10, timestamp: atSec(totalSeconds) };
}

function segment(startMinute: number, shape: Array<[number, number, number]> | null) {
  return { startTime: at(startMinute), shape };
}

describe("assembleTrackShape", () => {
  it("emits snapped segments in timestamp order regardless of input order", () => {
    const result = assembleTrackShape(
      [
        segment(20, [
          [37.2, 127, epoch(20)],
          [37.3, 127, epoch(30)],
        ]),
        segment(0, [
          [37, 127, epoch(0)],
          [37.1, 127, epoch(10)],
        ]),
      ],
      []
    );

    expect(result.map((point) => point.timestamp.toISOString())).toEqual(
      [0, 10, 20, 30].map((minute) => at(minute).toISOString())
    );
  });

  it("fills raw gaps without duplicating raw points inside snapped spans", () => {
    // Each segment's shape is dense (10s internal gaps, well under MAX_SHAPE_GAP_MS) so it
    // stays a single covered run; the real gap being tested is the one *between* segments.
    const result = assembleTrackShape(
      [
        segment(0, [
          [37, 127, epochSec(0)],
          [37.05, 127, epochSec(10)],
          [37.1, 127, epochSec(20)],
        ]),
        segment(5, [
          [37.2, 127, epochSec(200)],
          [37.25, 127, epochSec(210)],
          [37.3, 127, epochSec(220)],
        ]),
      ],
      [rawSec(5, 99), rawSec(110, 37.15), rawSec(215, 99)]
    );

    expect(result.map((point) => point.lat)).toEqual([37, 37.05, 37.1, 37.15, 37.2, 37.25, 37.3]);
  });

  it("falls back exactly to chronologically ordered raw points", () => {
    const result = assembleTrackShape([], [raw(20), raw(0), raw(10)]);

    expect(result).toEqual(
      [raw(0), raw(10), raw(20)].map((point) => ({
        ...point,
        timestamp: point.timestamp,
      }))
    );
  });

  it("ignores segments with null or empty shapes", () => {
    const points = [raw(0), raw(10)];

    expect(assembleTrackShape([segment(0, null), segment(5, [])], points)).toEqual(points);
  });

  it("fills the uncovered part of a segment window from raw points", () => {
    const result = assembleTrackShape(
      [
        segment(0, [
          [37.1, 127, epochSec(10)],
          [37.15, 127, epochSec(20)],
          [37.2, 127, epochSec(30)],
        ]),
      ],
      [rawSec(0, 37), rawSec(15, 99), rawSec(45, 37.03)]
    );

    expect(result.map((point) => point.lat)).toEqual([37, 37.1, 37.15, 37.2, 37.03]);
  });

  it("fills a hole inside one segment's shape with raw points instead of a straight line", () => {
    // Regression for the 2026-08-01 walking segment
    // (2cb7d666-5acb-4a4e-beff-1dc206ea3dd9): 6 shape points with a 118s hole in the middle,
    // where Valhalla dropped part of the trace as `unmatched`. Treating [min, max] of the
    // whole shape as covered suppressed 72 raw points that fell inside that hole and drew a
    // ~810m straight line across ground the raw GPS actually covered. This must fail against
    // the pre-fix single-window-per-segment implementation.
    const result = assembleTrackShape(
      [
        segment(0, [
          [37, 127, epochSec(0)],
          [37.01, 127, epochSec(6)],
          [37.02, 127, epochSec(12)],
          // 118s hole here, mirroring the production case.
          [37.5, 127, epochSec(130)],
          [37.51, 127, epochSec(136)],
          [37.52, 127, epochSec(142)],
        ]),
      ],
      [rawSec(60, 99), rawSec(90, 98)]
    );

    expect(result.map((point) => point.lat)).toEqual([
      37, 37.01, 37.02, 99, 98, 37.5, 37.51, 37.52,
    ]);
  });

  it("keeps a shape as a single run when internal gaps are ordinary sampling jitter", () => {
    const result = assembleTrackShape(
      [
        segment(0, [
          [37, 127, epochSec(0)],
          [37.01, 127, epochSec(12)],
          [37.02, 127, epochSec(24)],
        ]),
      ],
      [rawSec(6, 99), rawSec(18, 98)]
    );

    expect(result.map((point) => point.lat)).toEqual([37, 37.01, 37.02]);
  });

  it("emits only points accepted by the travel route timestamp contract", () => {
    const points = assembleTrackShape(
      [
        segment(0, [
          [37, 127, epoch(0)],
          [37.1, 127, epoch(10)],
        ]),
      ],
      [raw(20)]
    );

    expect(() =>
      parseTravelRoute({
        points: points.map((point) => ({
          ...point,
          timestamp: point.timestamp.toISOString(),
        })),
        count: points.length,
        rawSampledCount: 1,
        maxPoints: 1000,
      })
    ).not.toThrow();
    expect(points.every((point) => Number.isFinite(point.timestamp.getTime()))).toBe(true);
  });
});
