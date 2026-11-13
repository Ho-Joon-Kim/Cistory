import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/db/testing/mock-db";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getDb: vi.fn(),
  detectAndPersistVisits: vi.fn(),
}));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: mocks.getDb,
}));
vi.mock("@/modules/location/services/visit-persister", () => ({
  detectAndPersistVisits: mocks.detectAndPersistVisits,
}));

import { GET } from "./route";

beforeEach(() => {
  mocks.getAuthenticatedUser.mockResolvedValue({ user: { id: "user-1" }, error: null });
});

describe("GET /api/timeline/locations/stay-points", () => {
  it("reads persisted visits for a past date without running detection", async () => {
    const fake = createMockDb([
      [
        {
          id: "v1",
          centerLat: 37.5,
          centerLon: 127.0,
          radiusM: 40,
          startTime: new Date("2026-11-01T01:00:00Z"),
          endTime: new Date("2026-11-01T02:30:00Z"),
          durationSeconds: 5400,
          placeName: "회사",
          address: "서울",
          category: "work",
          city: "서울특별시",
          countryName: "대한민국",
          savedPlaceId: null,
        },
      ],
    ]);
    mocks.getDb.mockReturnValue(fake.db);

    const res = await GET(
      new NextRequest("http://localhost/api/timeline/locations/stay-points?date=2026-11-01")
    );

    expect(mocks.detectAndPersistVisits).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({
      stayPoints: [
        {
          lat: 37.5,
          lon: 127.0,
          placeName: "회사",
          address: "서울",
          category: "work",
          startTime: "2026-11-01T01:00:00.000Z",
          endTime: "2026-11-01T02:30:00.000Z",
          durationMinutes: 90,
          radiusM: 40,
          pointCount: 0,
        },
      ],
    });
    expect(fake.whereParams()[0]).toContain("user-1");
  });
});
