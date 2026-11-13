import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/db/testing/mock-db";

const mocks = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: mocks.getDb,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));
  mocks.getAuthenticatedUser.mockResolvedValue({ user: { id: "user-1" }, error: null });
});
afterEach(() => vi.useRealTimers());

describe("GET /api/timeline/current-activity", () => {
  it("returns inactive when no recent match exists", async () => {
    const fake = createMockDb([[]]);
    mocks.getDb.mockReturnValue(fake.db);
    const res = await GET(new NextRequest("http://localhost/api/timeline/current-activity"));
    expect(await res.json()).toEqual({ active: false, windowMinutes: 60 });
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=30");
    expect(fake.whereParams()[0]).toContain("user-1");
  });

  it("returns the latest ride with resolved line color", async () => {
    const fake = createMockDb([
      [{ id: "m1" }],
      [
        {
          match_id: "m1",
          sub_start_time: "2026-11-01T09:20:00Z",
          sub_end_time: "2026-11-01T09:40:00Z",
          total_confidence: "0.9",
          line_id: "l1",
          line_ref: "2",
          line_name: "2호선",
          line_colour: "#00A84D",
          line_network: "서울 지하철",
          fallback_idx: "0",
          start_station_name: "강남",
          end_station_name: "잠실",
        },
      ],
    ]);
    mocks.getDb.mockReturnValue(fake.db);
    const res = await GET(
      new NextRequest("http://localhost/api/timeline/current-activity?windowMinutes=9999")
    );
    expect(await res.json()).toEqual({
      active: true,
      minutesAgo: 20,
      windowMinutes: 720,
      line: { id: "l1", ref: "2", name: "2호선", color: expect.any(String) },
      startStationName: "강남",
      endStationName: "잠실",
      subStartTime: "2026-11-01T09:20:00.000Z",
      subEndTime: "2026-11-01T09:40:00.000Z",
      totalConfidence: 0.9,
    });
    expect(fake.executeParams()[0]).toContain("user-1");
  });
});
