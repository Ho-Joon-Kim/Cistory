import { describe, expect, it } from "vitest";
import { createMockDb } from "@/db/testing/mock-db";
import {
  decodeRawPointCursor,
  encodeRawPointCursor,
  findNearestPlaceWithinRadius,
  getLatestLocationPoint,
  getLatestSubwayRide,
  listRawLocationPoints,
  listVisits,
  RAW_POINTS_MAX_LIMIT,
} from "./queries";

const range = { start: new Date("2026-11-01T00:00:00Z"), end: new Date("2026-11-02T00:00:00Z") };

describe("getLatestLocationPoint", () => {
  it("returns null when there is no point", async () => {
    const fake = createMockDb([[]]);
    expect(await getLatestLocationPoint("user-1", fake.db)).toBeNull();
    expect(fake.whereParams()[0]).toEqual(["user-1"]);
  });

  it("returns the newest row", async () => {
    const row = { lat: 1, lon: 2, accuracy: 5, timestamp: new Date("2026-11-01T00:00:00Z") };
    expect(await getLatestLocationPoint("user-1", createMockDb([[row]]).db)).toEqual(row);
  });
});

describe("listRawLocationPoints", () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      lat: 37,
      lon: 127,
      accuracy: null,
      altitude: null,
      velocity: null,
      timestamp: new Date(Date.UTC(2026, 10, 1, 0, i)),
    }));

  it("returns a cursor for the next page when more rows exist", async () => {
    const fake = createMockDb([rows(3)]);
    const page = await listRawLocationPoints("user-1", range, { limit: 2 }, fake.db);
    expect(page.points.map((p) => p.id)).toEqual(["p0", "p1"]);
    expect(decodeRawPointCursor(page.nextCursor!)).toEqual({
      timestamp: "2026-11-01T00:01:00.000Z",
      id: "p1",
    });
    expect(fake.whereParams()[0]).toContain("user-1");
    // limit + 1 is fetched to detect another page.
    expect(fake.calls[0].chain.find((s) => s.method === "limit")?.args[0]).toBe(3);
  });

  it("continues strictly after the cursor and ends with a null cursor", async () => {
    const fake = createMockDb([rows(1)]);
    const cursor = { timestamp: "2026-11-01T00:01:00.000Z", id: "p1" };
    const page = await listRawLocationPoints("user-1", range, { cursor, limit: 2 }, fake.db);
    expect(page.nextCursor).toBeNull();
    expect(fake.whereParams()[0]).toContain("p1");
  });

  it("caps the page size", async () => {
    const fake = createMockDb([[]]);
    await listRawLocationPoints("user-1", range, { limit: 10_000 }, fake.db);
    expect(fake.calls[0].chain.find((s) => s.method === "limit")?.args[0]).toBe(
      RAW_POINTS_MAX_LIMIT + 1
    );
  });

  it("rejects malformed cursors", () => {
    expect(decodeRawPointCursor("garbage")).toBeNull();
    const encoded = encodeRawPointCursor({ timestamp: "2026-11-01T00:00:00.000Z", id: "x" });
    expect(decodeRawPointCursor(encoded)).toEqual({
      timestamp: "2026-11-01T00:00:00.000Z",
      id: "x",
    });
  });
});

describe("listVisits", () => {
  it("scopes the range query to the user", async () => {
    const fake = createMockDb([[]]);
    await listVisits("user-1", range, fake.db);
    expect(fake.whereParams()[0]).toContain("user-1");
    expect(fake.whereParams()[0]).not.toContain("user-2");
  });
});

describe("findNearestPlaceWithinRadius", () => {
  const places = [
    { id: "far", lat: 37.5, lon: 127.01, radiusM: 100 },
    { id: "near", lat: 37.5, lon: 127.0005, radiusM: 100 },
    { id: "big", lat: 37.5, lon: 127.0, radiusM: 2000 },
  ];

  it("picks the closest place whose radius contains the point", () => {
    expect(findNearestPlaceWithinRadius(places, 37.5, 127.0)?.place.id).toBe("big");
    expect(findNearestPlaceWithinRadius(places, 37.5, 127.0006)?.place.id).toBe("near");
  });

  it("returns null outside every radius", () => {
    expect(findNearestPlaceWithinRadius(places, 38, 128)).toBeNull();
  });
});

describe("getLatestSubwayRide", () => {
  it("returns null without querying details when no match exists", async () => {
    const fake = createMockDb([[]]);
    expect(await getLatestSubwayRide("user-1", {}, fake.db)).toBeNull();
    expect(fake.calls).toHaveLength(1);
  });

  it("reads the last processed ride without a window", async () => {
    const fake = createMockDb([
      [{ id: "m1" }],
      [
        {
          match_id: "m1",
          sub_start_time: "2026-11-01T09:20:00Z",
          sub_end_time: "2026-11-01T09:40:00Z",
          total_confidence: "0.5",
          line_id: "l1",
          line_ref: "2",
          line_name: "2호선",
          line_colour: "#00A84D",
          line_network: null,
          fallback_idx: 0,
          start_station_name: "강남",
          end_station_name: "잠실",
        },
      ],
    ]);
    const ride = await getLatestSubwayRide("user-1", {}, fake.db);
    expect(ride?.subEndTime.toISOString()).toBe("2026-11-01T09:40:00.000Z");
    expect(fake.executeParams()[0]).toEqual(["user-1"]);
  });
});
