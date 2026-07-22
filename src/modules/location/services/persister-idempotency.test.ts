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
      if (name === "transportation_segments") state.segmentCount = values.length;
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
});
