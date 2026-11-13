import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/db/testing/mock-db";

const mocks = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: mocks.getDb,
}));

import { GET } from "./route";

beforeEach(() => {
  mocks.getAuthenticatedUser.mockResolvedValue({ user: { id: "user-1" }, error: null });
});

describe("GET /api/timeline/locations/tracks", () => {
  it("embeds segments and subway legs under each track", async () => {
    const fake = createMockDb([
      [
        {
          id: "t1",
          startTime: new Date("2026-11-01T00:00:00Z"),
          endTime: new Date("2026-11-01T00:40:00Z"),
          distanceMeters: 12000,
          durationSeconds: 2400,
          pointCount: 50,
          startPlaceName: "집",
          endPlaceName: "회사",
          dominantMode: "subway",
          elevationGain: 1,
          elevationLoss: 2,
        },
      ],
      [
        {
          id: "s1",
          trackId: "t1",
          mode: "subway",
          confidence: "high",
          startTime: new Date("2026-11-01T00:05:00Z"),
          endTime: new Date("2026-11-01T00:35:00Z"),
          distanceMeters: 11000,
          durationSeconds: 1800,
          avgSpeedKmh: 22,
          maxSpeedKmh: 60,
        },
      ],
      [
        {
          segment_id: "s1",
          line_id: "l1",
          line_ref: "2",
          line_name: "2호선",
          line_colour: "#00A84D",
          line_network: null,
          fallback_idx: 0,
          start_station_name: "강남",
          end_station_name: "잠실",
          session_id: "sess",
          leg_order: "0",
          total_confidence: "0.8",
        },
      ],
    ]);
    mocks.getDb.mockReturnValue(fake.db);

    const res = await GET(
      new NextRequest("http://localhost/api/timeline/locations/tracks?date=2026-11-01")
    );

    expect(await res.json()).toEqual({
      tracks: [
        {
          id: "t1",
          startTime: "2026-11-01T00:00:00.000Z",
          endTime: "2026-11-01T00:40:00.000Z",
          distanceMeters: 12000,
          durationSeconds: 2400,
          pointCount: 50,
          startPlaceName: "집",
          endPlaceName: "회사",
          dominantMode: "subway",
          elevationGain: 1,
          elevationLoss: 2,
          segments: [
            {
              id: "s1",
              mode: "subway",
              confidence: "high",
              startTime: "2026-11-01T00:05:00.000Z",
              endTime: "2026-11-01T00:35:00.000Z",
              distanceMeters: 11000,
              durationSeconds: 1800,
              avgSpeedKmh: 22,
              maxSpeedKmh: 60,
              subwayLegs: [
                {
                  lineId: "l1",
                  lineRef: "2",
                  lineName: "2호선",
                  lineColor: "#00A84D",
                  startStationName: "강남",
                  endStationName: "잠실",
                  sessionId: "sess",
                  legOrder: 0,
                  totalConfidence: 0.8,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(fake.whereParams()[0]).toContain("user-1");
  });

  it("returns an empty list without querying segments", async () => {
    const fake = createMockDb([[]]);
    mocks.getDb.mockReturnValue(fake.db);
    const res = await GET(
      new NextRequest("http://localhost/api/timeline/locations/tracks?date=2026-11-01")
    );
    expect(await res.json()).toEqual({ tracks: [] });
    expect(fake.calls).toHaveLength(1);
  });
});
