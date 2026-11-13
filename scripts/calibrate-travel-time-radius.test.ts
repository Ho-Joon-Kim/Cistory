import { describe, expect, it } from "vitest";
import type { Journey, VisitRow } from "../src/modules/location/travel-time";
import {
  countChainedTracks,
  medianDrift,
  pickRadius,
  scorePair,
  sumScores,
} from "./calibrate-travel-time-radius";

const A = { id: "A", lat: 37.5, lon: 127.0 };
const B = { id: "B", lat: 37.52, lon: 127.03 };
const t0 = new Date("2026-11-02T08:00:00+09:00");

function v(lat: number, lon: number, savedPlaceId: string | null): VisitRow {
  return { centerLat: lat, centerLon: lon, startTime: t0, endTime: t0, savedPlaceId };
}

function j(origin: VisitRow, destination: VisitRow): Journey {
  return {
    trackId: "t",
    startTime: t0,
    endTime: t0,
    durationSeconds: 1_800,
    mode: "train",
    origin,
    destination,
  };
}

describe("scorePair", () => {
  it("counts recall against pinned truth and mismatch against other pins", () => {
    const journeys = [
      j(v(37.5, 127.0, "A"), v(37.52, 127.03, "B")), // truth, near
      j(v(37.504, 127.0, "A"), v(37.52, 127.03, "B")), // truth, ~445 m off
      j(v(37.5005, 127.0, "C"), v(37.52, 127.03, null)), // near, pinned elsewhere
      j(v(37.5, 127.0, null), v(37.52, 127.03, null)), // near, unpinned
    ];
    const at300 = scorePair(journeys, A, B, 300);
    expect(at300).toEqual({ truth: 2, retrieved: 3, hit: 1, mismatched: 1 });
    expect(sumScores([at300])).toEqual({ recall: 0.5, mismatch: 1 / 3 });
    expect(scorePair(journeys, A, B, 500).hit).toBe(2);
  });
});

describe("pickRadius", () => {
  it("takes the smallest radius meeting recall and mismatch targets", () => {
    expect(
      pickRadius([
        { radiusM: 100, recall: 0.6, mismatch: 0 },
        { radiusM: 300, recall: 0.92, mismatch: 0.02 },
        { radiusM: 500, recall: 0.97, mismatch: 0.04 },
      ])
    ).toBe(300);
  });

  it("falls back to the best recall under the mismatch cap", () => {
    expect(
      pickRadius([
        { radiusM: 100, recall: 0.5, mismatch: 0 },
        { radiusM: 300, recall: 0.7, mismatch: 0.01 },
        { radiusM: 500, recall: 0.95, mismatch: 0.2 },
      ])
    ).toBe(300);
    expect(pickRadius([{ radiusM: 100, recall: null, mismatch: null }])).toBeNull();
  });
});

describe("countChainedTracks", () => {
  const track = (startMin: number, endMin: number) => ({
    id: `${startMin}`,
    startTime: new Date(t0.getTime() + startMin * 60_000),
    endTime: new Date(t0.getTime() + endMin * 60_000),
    durationSeconds: (endMin - startMin) * 60,
    dominantMode: "train",
  });
  const stop = (startMin: number, endMin: number): VisitRow => ({
    centerLat: 0,
    centerLon: 0,
    startTime: new Date(t0.getTime() + startMin * 60_000),
    endTime: new Date(t0.getTime() + endMin * 60_000),
    savedPlaceId: null,
  });

  it("chains tracks split by a short stop but not by a long visit", () => {
    expect(countChainedTracks([track(0, 20), track(28, 50)], [stop(21, 27)]).chains).toBe(1);
    expect(countChainedTracks([track(0, 20), track(28, 50)], []).chains).toBe(1);
    expect(countChainedTracks([track(0, 20), track(45, 60)], [stop(21, 44)]).chains).toBe(0);
    expect(countChainedTracks([track(0, 20), track(90, 100)], []).chains).toBe(0);
  });
});

describe("medianDrift", () => {
  it("measures how far the median of the first k lands from the full median", () => {
    const drift = medianDrift([30, 50, 40, 40, 40], [2, 5]);
    expect(drift[0]).toBeCloseTo(0, 10);
    expect(drift[1]).toBe(0);
    expect(medianDrift([20, 40, 40], [1])[0]).toBeCloseTo(0.5, 10);
  });
});
