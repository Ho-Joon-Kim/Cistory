import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentLocationTool, gpsPointsTool, locationHistoryTool } from "./location";
import { callTool, TEST_USER_ID } from "./test-context";

const mocks = vi.hoisted(() => ({
  getLatestLocationPoint: vi.fn(),
  getLatestVisit: vi.fn(),
  getLatestSubwayRide: vi.fn(),
  listRawLocationPoints: vi.fn(),
  listVisits: vi.fn(),
  listTracks: vi.fn(),
  listSavedPlaces: vi.fn(),
  getLocationDataThrough: vi.fn(),
}));

vi.mock("@/modules/location/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/location/queries")>();
  return {
    ...actual,
    getLatestLocationPoint: mocks.getLatestLocationPoint,
    getLatestVisit: mocks.getLatestVisit,
    getLatestSubwayRide: mocks.getLatestSubwayRide,
    listRawLocationPoints: mocks.listRawLocationPoints,
    listVisits: mocks.listVisits,
    listTracks: mocks.listTracks,
  };
});
vi.mock("@/modules/location/saved-places", () => ({ listSavedPlaces: mocks.listSavedPlaces }));
vi.mock("./data", () => ({ getLocationDataThrough: mocks.getLocationDataThrough }));

beforeEach(() => {
  mocks.getLatestLocationPoint.mockResolvedValue(null);
  mocks.getLatestVisit.mockResolvedValue(null);
  mocks.getLatestSubwayRide.mockResolvedValue(null);
  mocks.getLocationDataThrough.mockResolvedValue(null);
  mocks.listSavedPlaces.mockResolvedValue([]);
  mocks.listVisits.mockResolvedValue([]);
  mocks.listTracks.mockResolvedValue([]);
});

describe("current_location", () => {
  it("with no location data says 기록 없음 and invents no coordinates", async () => {
    const out = await callTool(currentLocationTool, {});
    expect(out.structured.status).toBe("no_data");
    expect(out.structured.message).toContain("기록 없음");
    expect(out.structured.latestPoint).toBeNull();
    expect(out.structured.nearSavedPlace).toBeNull();
    expect(JSON.stringify(out.structured)).not.toMatch(/"lat"|"lon"/);
    expect(out.count).toBe(0);
  });

  it("returns the latest point at +09:00 with minutes elapsed and the saved place it falls in", async () => {
    // ctx.now is 2026-11-13T09:00:00Z; the fix is 42 minutes older.
    mocks.getLatestLocationPoint.mockResolvedValue({
      lat: 37.5,
      lon: 127.0,
      accuracy: 20,
      timestamp: new Date("2026-11-13T08:18:00Z"),
    });
    mocks.listSavedPlaces.mockResolvedValue([
      { id: "home", name: "집", category: "home", lat: 37.5003, lon: 127.0, radiusM: 50 },
      { id: "far", name: "회사", category: "work", lat: 37.6, lon: 127.1, radiusM: 100 },
    ]);
    mocks.getLatestVisit.mockResolvedValue({
      placeName: "어딘가",
      savedPlaceId: "home",
      address: "서울",
      startTime: new Date("2026-11-12T10:00:00Z"),
      endTime: new Date("2026-11-12T12:00:00Z"),
    });
    mocks.getLocationDataThrough.mockResolvedValue("2026-11-12");
    mocks.getLatestSubwayRide.mockResolvedValue({
      line: { id: "l", ref: "2", name: "2호선", color: "#0" },
      startStationName: "강남",
      endStationName: "역삼",
      subStartTime: new Date("2026-11-12T00:00:00Z"),
      subEndTime: new Date("2026-11-12T00:05:00Z"),
      totalConfidence: 0.9,
    });

    const out = await callTool(currentLocationTool, {});
    expect(out.structured.latestPoint).toEqual({
      lat: 37.5,
      lon: 127.0,
      accuracyM: 20,
      recordedAt: "2026-11-13T17:18:00+09:00",
      minutesAgo: 42,
    });
    expect(out.structured.nearSavedPlace).toMatchObject({ id: "home", name: "집" });
    expect(out.structured.visitDataThrough).toBe("2026-11-12");
    expect(out.structured.lastVisit).toMatchObject({
      savedPlaceName: "집",
      endTime: "2026-11-12T21:00:00+09:00",
    });
    expect(out.structured.lastProcessedSubwayRide).toMatchObject({
      label: expect.stringContaining("처리된 마지막 탑승"),
      startTime: "2026-11-12T09:00:00+09:00",
    });
    expect(mocks.getLatestSubwayRide).toHaveBeenCalledWith(TEST_USER_ID, {}, expect.anything());
  });
});

describe("gps_points", () => {
  it("caps limit at 500 and passes the decoded cursor and range through", async () => {
    expect(gpsPointsTool.inputSchema.safeParse({ limit: 501 }).success).toBe(false);
    mocks.listRawLocationPoints.mockResolvedValue({
      points: [
        {
          id: "p1",
          lat: 1,
          lon: 2,
          accuracy: 5,
          altitude: null,
          velocity: 0,
          timestamp: new Date("2026-11-13T00:00:00Z"),
        },
      ],
      nextCursor: "next",
    });
    const cursor = Buffer.from(
      JSON.stringify({ timestamp: "2026-11-12T23:00:00.000Z", id: "p0" })
    ).toString("base64url");
    const out = await callTool(gpsPointsTool, { from: "2026-11-13", limit: 500, cursor });
    const [userId, range, page] = mocks.listRawLocationPoints.mock.calls[0];
    expect(userId).toBe(TEST_USER_ID);
    expect(range.start.toISOString()).toBe("2026-11-12T15:00:00.000Z");
    expect(page).toEqual({
      cursor: { timestamp: "2026-11-12T23:00:00.000Z", id: "p0" },
      limit: 500,
    });
    expect(out.structured.nextCursor).toBe("next");
    expect((out.structured.points as { recordedAt: string }[])[0].recordedAt).toBe(
      "2026-11-13T09:00:00+09:00"
    );
  });

  it("rejects a malformed cursor and a range over 31 days", async () => {
    await expect(callTool(gpsPointsTool, { cursor: "nope" })).rejects.toThrow(/cursor/);
    await expect(callTool(gpsPointsTool, { from: "2026-09-01", to: "2026-11-13" })).rejects.toThrow(
      /최대 31일/
    );
  });
});

describe("location_history", () => {
  it("pages visits and tracks with one cursor and renders KST times", async () => {
    const visit = (i: number) => ({
      id: `v${i}`,
      startTime: new Date(`2026-11-1${i}T00:00:00Z`),
      endTime: new Date(`2026-11-1${i}T01:00:00Z`),
      durationSeconds: 3600,
      placeName: `장소${i}`,
      centerLat: 37,
      centerLon: 127,
      radiusM: 30,
      userId: TEST_USER_ID,
    });
    mocks.listVisits.mockResolvedValue([visit(1), visit(2), visit(3)]);
    const first = await callTool(locationHistoryTool, {
      from: "2026-11-10",
      to: "2026-11-13",
      limit: 2,
    });
    const visits = first.structured.visits as Record<string, unknown>[];
    expect(visits.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(visits[0]).toMatchObject({
      startTime: "2026-11-11T09:00:00+09:00",
      durationMinutes: 60,
    });
    expect(visits[0]).not.toHaveProperty("userId");
    const second = await callTool(locationHistoryTool, {
      from: "2026-11-10",
      to: "2026-11-13",
      limit: 2,
      cursor: first.structured.nextCursor,
    });
    expect((second.structured.visits as { id: string }[]).map((v) => v.id)).toEqual(["v3"]);
    expect(second.structured.nextCursor).toBeNull();
  });
});
