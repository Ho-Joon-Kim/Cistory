process.env.TZ = "Asia/Seoul";

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  points: [] as {
    lat: number;
    lon: number;
    altitude: number | null;
    velocity: number | null;
    timestamp: Date;
  }[],
  trackIds: [] as string[],
  segmentCount: 0,
  segments: [] as { mode: string; confidence: string }[],
  healthRows: [] as unknown[],
  visitCount: 0,
}));

vi.mock("@/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db")>();
  const nameOf = (table: object) => (table as Record<symbol, string>)[Symbol.for("drizzle:Name")];
  const query = <T>(data: T) => {
    const promise = Promise.resolve(data);
    return Object.assign(promise, { orderBy: () => promise });
  };

  const select = () => ({
    from: (table: object) => ({
      where: () => {
        const name = nameOf(table);
        if (name === "location_points") return query([...state.points]);
        if (name === "tracks") return query(state.trackIds.map((id) => ({ id })));
        if (name === "health_samples") return query([...state.healthRows]);
        return query([]);
      },
    }),
  });
  const deleteFrom = (table: object) => ({
    where: async () => {
      const name = nameOf(table);
      if (name === "tracks") state.trackIds = [];
      if (name === "transportation_segments") state.segmentCount = 0;
      if (name === "visits") state.visitCount = 0;
    },
  });
  const insert = (table: object) => ({
    values: (values: unknown[]) => {
      const name = nameOf(table);
      if (name === "tracks") {
        state.trackIds = values.map((_, index) => `track-${index}`);
        return { returning: async () => state.trackIds.map((id) => ({ id })) };
      }
      if (name === "transportation_segments") {
        state.segmentCount = values.length;
        state.segments = values as { mode: string; confidence: string }[];
      }
      return Promise.resolve();
    },
  });
  const db = {
    select,
    delete: deleteFrom,
    insert,
    transaction: async <T>(callback: (tx: unknown) => Promise<T>) =>
      callback({ select, delete: deleteFrom, insert }),
  };
  return { ...actual, getDb: () => db };
});

import { detectAndPersistTracks } from "./track-persister";
import { detectAndPersistVisits } from "./visit-persister";

beforeEach(() => {
  state.points = [];
  state.trackIds = [];
  state.segmentCount = 0;
  state.segments = [];
  state.healthRows = [];
  state.visitCount = 0;
});

describe("daily persister idempotency", () => {
  it("clears stale visits on every empty-day rebuild", async () => {
    state.visitCount = 3;

    await detectAndPersistVisits("user-1", "2026-07-22");
    await detectAndPersistVisits("user-1", "2026-07-22");

    expect(state.visitCount).toBe(0);
  });

  it("replaces tracks and transportation segments instead of accumulating them", async () => {
    state.points = [
      {
        lat: 37.5,
        lon: 127,
        altitude: null,
        velocity: 1.5,
        timestamp: new Date("2026-07-21T15:00:00.000Z"),
      },
      {
        lat: 37.5,
        lon: 127.001,
        altitude: null,
        velocity: 1.5,
        timestamp: new Date("2026-07-21T15:01:00.000Z"),
      },
      {
        lat: 37.5,
        lon: 127.002,
        altitude: null,
        velocity: 1.5,
        timestamp: new Date("2026-07-21T15:02:00.000Z"),
      },
    ];

    const first = await detectAndPersistTracks("user-1", "2026-07-22");
    const firstState = { tracks: state.trackIds.length, segments: state.segmentCount };
    const second = await detectAndPersistTracks("user-1", "2026-07-22");

    expect(second).toEqual(first);
    expect({ tracks: state.trackIds.length, segments: state.segmentCount }).toEqual(firstState);
    expect(first.trackCount).toBe(1);
    expect(first.segmentCount).toBeGreaterThan(0);
  });

  it("labels a ride from the day's exercise session (one batched health lookup)", async () => {
    // 15 minutes at ~13 km/h, one point every 10 s, starting 08:51 KST.
    const start = new Date("2026-11-09T23:51:00.000Z").getTime();
    state.points = Array.from({ length: 91 }, (_, i) => ({
      lat: 37.5,
      lon: 127 + i * 0.00041,
      altitude: null,
      velocity: null,
      timestamp: new Date(start + i * 10_000),
    }));
    state.healthRows = [
      {
        sampleAt: new Date("2026-11-09T23:50:45.600Z"),
        source: "FITBIT",
        value: 14.4,
        valueJson: {
          exerciseType: "ELECTRIC_BIKE",
          interval: {
            startTime: "2026-11-09T23:50:45.600Z",
            endTime: "2026-11-10T00:07:10.600Z",
          },
        },
      },
    ];

    await detectAndPersistTracks("user-1", "2026-11-10");

    expect(state.segments).toHaveLength(1);
    expect(state.segments[0]).toMatchObject({ mode: "cycling", confidence: "high" });
  });
});
