import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  detectTrips: vi.fn(),
  detectTripsSnapshot: vi.fn(),
  persistTrips: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/modules/location/services/trip-detector", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/location/services/trip-detector")>();
  return {
    ...actual,
    detectTrips: mocks.detectTrips,
    detectTripsSnapshot: mocks.detectTripsSnapshot,
    persistTrips: mocks.persistTrips,
  };
});

import { POST } from "./route";

const trip = {
  name: "부산",
  startDate: "2026-07-01",
  endDate: "2026-07-02",
  visitedCities: ["부산"],
  visitedCountries: ["대한민국"],
  isOverseas: false,
  totalDistanceMeters: null,
};

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/trips/detect", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/trips/detect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue({ user: { id: "user-1" }, error: null });
    mocks.detectTrips.mockResolvedValue([trip]);
    mocks.detectTripsSnapshot.mockResolvedValue({
      trips: [trip],
      exclusionRevision: "revision-1",
    });
    mocks.persistTrips.mockResolvedValue(1);
  });

  it("handles confirm payloads before dry-run date validation", async () => {
    const response = await POST(
      request({ confirm: true, trips: [trip], exclusionRevision: "revision-1" })
    );

    expect(response.status).toBe(200);
    expect(mocks.persistTrips).toHaveBeenCalledWith("user-1", [trip], "revision-1");
    expect(mocks.detectTripsSnapshot).not.toHaveBeenCalled();
  });

  it("rejects malformed detected trips instead of persisting client input", async () => {
    const response = await POST(
      request({
        confirm: true,
        trips: [{ ...trip, endDate: null }],
        exclusionRevision: "revision-1",
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.persistTrips).not.toHaveBeenCalled();
  });

  it("dry run과 confirm 사이 제외 설정을 비교할 revision을 반환한다", async () => {
    const response = await POST(request({ from: "2026-07-01", to: "2026-07-02" }));

    expect(await response.json()).toMatchObject({
      trips: [trip],
      total: 1,
      exclusionRevision: "revision-1",
    });
  });

  it("requires a valid date range for dry-run detection", async () => {
    const response = await POST(request({ from: "2026-02-30", to: "2026-03-01" }));

    expect(response.status).toBe(400);
    expect(mocks.detectTrips).not.toHaveBeenCalled();
  });
});
