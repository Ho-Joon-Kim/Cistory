process.env.TZ = "Asia/Seoul";

import { describe, expect, it } from "vitest";
import { parseTravelRoute } from "@/modules/travel/hooks";
import { assembleTrackShape } from "./track-shape";

const at = (minute: number) => new Date(Date.UTC(2026, 6, 15, 0, minute));
const epoch = (minute: number) => at(minute).getTime();

function raw(minute: number, lat = 37 + minute / 1000) {
  return { lat, lon: 127, accuracy: 10, timestamp: at(minute) };
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
    const result = assembleTrackShape(
      [
        segment(0, [
          [37, 127, epoch(0)],
          [37.1, 127, epoch(10)],
        ]),
        segment(20, [
          [37.2, 127, epoch(20)],
          [37.3, 127, epoch(30)],
        ]),
      ],
      [raw(5, 99), raw(15, 37.15), raw(25, 99)]
    );

    expect(result.map((point) => point.lat)).toEqual([37, 37.1, 37.15, 37.2, 37.3]);
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
          [37.1, 127, epoch(10)],
          [37.2, 127, epoch(20)],
        ]),
      ],
      [raw(0), raw(15, 99), raw(30)]
    );

    expect(result.map((point) => point.lat)).toEqual([37, 37.1, 37.2, 37.03]);
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
