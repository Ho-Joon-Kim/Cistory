import { describe, expect, it } from "vitest";
import { getPositionAtProgress, getProgressAtTime } from "./useRouteReplay";

const points = [
  { lat: 37, lon: 127, time: 0, timestamp: "1970-01-01T00:00:00.000Z" },
  { lat: 38, lon: 129, time: 10_000, timestamp: "1970-01-01T00:00:10.000Z" },
];

describe("route replay timeline", () => {
  it("interpolates the marker and displayed time on the same timeline", () => {
    expect(getPositionAtProgress(points, 0.25)).toEqual({
      coord: { lat: 37.25, lon: 127.5 },
      timestamp: "1970-01-01T00:00:02.500Z",
    });
  });

  it("converts a stay end time to the progress where playback should resume", () => {
    expect(getProgressAtTime(points, 7_500)).toBe(0.75);
  });

  it("clamps timestamps outside the replay range", () => {
    expect(getProgressAtTime(points, -1)).toBe(0);
    expect(getProgressAtTime(points, 20_000)).toBe(1);
  });
});
