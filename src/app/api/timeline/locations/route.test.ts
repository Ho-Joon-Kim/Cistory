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

const point = (lat: number, lon: number, iso: string) => ({
  lat,
  lon,
  accuracy: 10,
  altitude: 30,
  velocity: 0,
  battery: 80,
  timestamp: new Date(iso),
});

beforeEach(() => {
  mocks.getAuthenticatedUser.mockResolvedValue({ user: { id: "user-1" }, error: null });
});

describe("GET /api/timeline/locations", () => {
  it("drops points within 100m of the previous one and serializes timestamps", async () => {
    const fake = createMockDb([
      [
        point(37.5, 127.0, "2026-11-01T00:00:00Z"),
        point(37.5001, 127.0, "2026-11-01T00:01:00Z"),
        point(37.51, 127.0, "2026-11-01T00:02:00Z"),
      ],
    ]);
    mocks.getDb.mockReturnValue(fake.db);

    const res = await GET(
      new NextRequest("http://localhost/api/timeline/locations?date=2026-11-01")
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      locations: [
        {
          lat: 37.5,
          lon: 127.0,
          accuracy: 10,
          altitude: 30,
          velocity: 0,
          battery: 80,
          timestamp: "2026-11-01T00:00:00.000Z",
        },
        {
          lat: 37.51,
          lon: 127.0,
          accuracy: 10,
          altitude: 30,
          velocity: 0,
          battery: 80,
          timestamp: "2026-11-01T00:02:00.000Z",
        },
      ],
      count: 2,
    });
    expect(fake.whereParams()[0]).toContain("user-1");
  });

  it("downsamples to 500 points keeping the last one", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) =>
      point(37 + i * 0.01, 127, new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString())
    );
    mocks.getDb.mockReturnValue(createMockDb([rows]).db);

    const body = await (
      await GET(
        new NextRequest("http://localhost/api/timeline/locations?date=2026-11-01&minDistance=false")
      )
    ).json();

    expect(body.count).toBe(500);
    expect(body.locations[0].lat).toBe(37);
    expect(body.locations[499].lat).toBeCloseTo(37 + 999 * 0.01);
  });

  it("rejects a missing date", async () => {
    const res = await GET(new NextRequest("http://localhost/api/timeline/locations"));
    expect(res.status).toBe(400);
  });
});
