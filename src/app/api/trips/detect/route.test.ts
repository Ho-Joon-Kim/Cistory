import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  detectTrips: vi.fn(),
  persistTrips: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/modules/location/services/trip-detector", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/location/services/trip-detector")>();
  return { ...actual, detectTrips: mocks.detectTrips, persistTrips: mocks.persistTrips };
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
    mocks.persistTrips.mockResolvedValue(1);
  });

  it("handles confirm payloads before dry-run date validation", async () => {
    const response = await POST(request({ confirm: true, trips: [trip] }));

    expect(response.status).toBe(200);
    expect(mocks.persistTrips).toHaveBeenCalledWith("user-1", [trip]);
    expect(mocks.detectTrips).not.toHaveBeenCalled();
  });

  it("rejects malformed detected trips instead of persisting client input", async () => {
    const response = await POST(request({ confirm: true, trips: [{ ...trip, endDate: null }] }));

    expect(response.status).toBe(400);
    expect(mocks.persistTrips).not.toHaveBeenCalled();
  });

  it("requires a valid date range for dry-run detection", async () => {
    const response = await POST(request({ from: "2026-02-30", to: "2026-03-01" }));

    expect(response.status).toBe(400);
    expect(mocks.detectTrips).not.toHaveBeenCalled();
  });
});
