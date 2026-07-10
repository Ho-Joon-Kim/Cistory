import { describe, expect, it } from "vitest";
import type { LocationData, StayPointData } from "./hooks";
import { clipMovingSegmentsAtTime, createStayPointConnectors, segmentLocations } from "./utils";

function location(minute: number, lon: number): LocationData {
  return {
    lat: 37.5,
    lon,
    accuracy: null,
    altitude: null,
    velocity: null,
    battery: null,
    timestamp: `2026-07-10T00:${minute.toString().padStart(2, "0")}:00.000Z`,
  };
}

function stay(startMinute: number, endMinute: number): StayPointData {
  return {
    lat: 37.5,
    lon: 127.0,
    placeName: "집",
    address: null,
    category: "home",
    startTime: `2026-07-10T00:${startMinute.toString().padStart(2, "0")}:00.000Z`,
    endTime: `2026-07-10T00:${endMinute.toString().padStart(2, "0")}:00.000Z`,
    durationMinutes: endMinute - startMinute,
  };
}

describe("segmentLocations", () => {
  it("keeps the first stay point as the arrival route endpoint", () => {
    const segments = segmentLocations(
      [location(0, 126.997), location(5, 126.999), location(10, 127.0), location(15, 127.001)],
      [stay(10, 20)]
    );

    expect(segments[0]).toMatchObject({
      type: "moving",
      coords: [
        [126.997, 37.5],
        [126.999, 37.5],
        [127.0, 37.5],
      ],
      endTime: "2026-07-10T00:10:00.000Z",
    });
  });

  it("keeps only the last stay point as the departure route start", () => {
    const segments = segmentLocations(
      [
        location(10, 127.0),
        location(15, 127.0001),
        location(20, 127.0002),
        location(25, 127.002),
        location(30, 127.004),
      ],
      [stay(10, 20)]
    );

    expect(segments[1]).toMatchObject({
      type: "moving",
      coords: [
        [127.0002, 37.5],
        [127.002, 37.5],
        [127.004, 37.5],
      ],
      startTime: "2026-07-10T00:20:00.000Z",
    });
  });

  it("does not draw stationary points between the arrival and departure anchors", () => {
    const segments = segmentLocations(
      [
        location(0, 126.997),
        location(10, 127.0),
        location(12, 127.0001),
        location(14, 127.0002),
        location(20, 127.0003),
        location(25, 127.003),
      ],
      [stay(10, 20)]
    );

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({
      type: "moving",
      coords: [
        [126.997, 37.5],
        [127.0, 37.5],
      ],
    });
    expect(segments[2]).toMatchObject({
      type: "moving",
      coords: [
        [127.0003, 37.5],
        [127.003, 37.5],
      ],
    });
  });
});

describe("createStayPointConnectors", () => {
  it("connects saved-place arrival and departure key points to the canonical coordinate", () => {
    const savedStay = { ...stay(10, 20), savedPlaceId: "home" };
    const connectors = createStayPointConnectors(
      [location(10, 127.001), location(15, 127.002), location(20, 127.003)],
      [savedStay],
      [{ id: "home", lat: 37.5, lon: 127 }]
    );

    expect(connectors.map((connector) => connector.coords)).toEqual([
      [
        [127.001, 37.5],
        [127, 37.5],
      ],
      [
        [127, 37.5],
        [127.003, 37.5],
      ],
    ]);
  });

  it("does not connect an unmatched stay point", () => {
    expect(
      createStayPointConnectors(
        [location(10, 127.001)],
        [stay(10, 20)],
        [{ id: "home", lat: 37.5, lon: 127 }]
      )
    ).toEqual([]);
  });
});

describe("clipMovingSegmentsAtTime", () => {
  it("starts with an empty route and restores the full route at the end", () => {
    const segments = segmentLocations([location(0, 127), location(10, 128)], []);

    expect(
      clipMovingSegmentsAtTime(segments, new Date("2026-07-09T23:59:59.000Z").getTime()).lines
    ).toEqual([]);
    expect(
      clipMovingSegmentsAtTime(segments, new Date("2026-07-10T00:10:00.000Z").getTime()).lines
    ).toEqual([
      [
        [127, 37.5],
        [128, 37.5],
      ],
    ]);
  });

  it("draws the route only through the interpolated replay position", () => {
    const segments = segmentLocations([location(0, 127), location(10, 128), location(20, 129)], []);

    expect(
      clipMovingSegmentsAtTime(segments, new Date("2026-07-10T00:05:00.000Z").getTime())
    ).toEqual({
      lines: [
        [
          [127, 37.5],
          [127.5, 37.5],
        ],
      ],
      segmentIndices: [0],
    });
  });

  it("does not include future moving segments across a stay", () => {
    const segments = segmentLocations(
      [location(0, 126), location(10, 127), location(20, 127.1), location(30, 128)],
      [stay(10, 20)]
    );

    const clipped = clipMovingSegmentsAtTime(
      segments,
      new Date("2026-07-10T00:15:00.000Z").getTime()
    );
    expect(clipped.segmentIndices).toEqual([0]);
  });
});
