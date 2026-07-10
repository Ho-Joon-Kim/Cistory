import { describe, expect, it } from "vitest";
import type { LocationData, StayPointData } from "./hooks";
import { buildReplayTimeline, getReplayFrame } from "./replay-timeline";

function location(minute: number, lat: number): LocationData {
  return {
    lat,
    lon: 127,
    accuracy: null,
    altitude: null,
    velocity: null,
    battery: null,
    timestamp: `2026-07-10T00:${minute.toString().padStart(2, "0")}:00.000Z`,
  };
}

function stay(startMinute: number, endMinute: number): StayPointData {
  return {
    lat: 37.001,
    lon: 127,
    placeName: "집",
    address: null,
    category: "home",
    startTime: `2026-07-10T00:${startMinute.toString().padStart(2, "0")}:00.000Z`,
    endTime: `2026-07-10T00:${endMinute.toString().padStart(2, "0")}:00.000Z`,
    durationMinutes: endMinute - startMinute,
  };
}

describe("replay presentation timeline", () => {
  it("moves by distance rather than irregular GPS sampling time", () => {
    const timeline = buildReplayTimeline(
      [location(0, 37), location(10, 37.001), location(20, 37.004)],
      []
    );
    const frame = getReplayFrame(timeline, 0.5);

    expect(frame?.phase).toBe("moving");
    expect(frame?.coord.lat).toBeCloseTo(37.002, 5);
    expect(frame?.recordedTime).toBeCloseTo(new Date("2026-07-10T00:13:20.000Z").getTime(), -2);
  });

  it("represents a stay as a continuous one-second scene without moving the marker", () => {
    const timeline = buildReplayTimeline(
      [location(0, 37), location(10, 37.001), location(20, 37.001), location(30, 37.002)],
      [stay(10, 20)]
    );
    const stayEvent = timeline.events.find((event) => event.type === "staying");
    expect(stayEvent).toBeDefined();

    const stayMidpoint = ((stayEvent?.startMs ?? 0) + 500) / timeline.durationMs;
    const frame = getReplayFrame(timeline, stayMidpoint);
    expect(frame).toMatchObject({
      phase: "staying",
      coord: { lat: 37.001, lon: 127 },
      timestamp: "2026-07-10T00:15:00.000Z",
    });
  });

  it("clamps seeking to the beginning and end", () => {
    const timeline = buildReplayTimeline([location(0, 37), location(10, 37.001)], []);

    expect(getReplayFrame(timeline, -1)?.progress).toBe(0);
    expect(getReplayFrame(timeline, 2)?.progress).toBe(1);
    expect(getReplayFrame(timeline, 2)?.timestamp).toBe("2026-07-10T00:10:00.000Z");
  });

  it("advances recorded time when stationary coordinates have no distance", () => {
    const timeline = buildReplayTimeline([location(0, 37), location(10, 37)], []);

    expect(getReplayFrame(timeline, 0.5)).toMatchObject({
      coord: { lat: 37, lon: 127 },
      timestamp: "2026-07-10T00:05:00.000Z",
    });
  });
});
