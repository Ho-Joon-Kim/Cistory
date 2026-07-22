import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  markTripNotATrip: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/modules/travel/not-a-trip", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/travel/not-a-trip")>();
  return { ...actual, markTripNotATrip: mocks.markTripNotATrip };
});

import { TripHasNoVisitsError, TripNotFoundError } from "@/modules/travel/not-a-trip";
import { POST } from "./route";

function request() {
  return new NextRequest("http://localhost/api/trips/trip-1/not-a-trip", { method: "POST" });
}

const context = { params: Promise.resolve({ id: "trip-1" }) };

describe("POST /api/trips/:id/not-a-trip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue({ user: { id: "user-1" }, error: null });
  });

  it("인증 사용자와 여행 ID만 서비스에 전달한다", async () => {
    mocks.markTripNotATrip.mockResolvedValue({
      tripId: "trip-1",
      reusedPlace: false,
      place: { id: "place-1", excludeFromTrips: true, tripExclusionRadiusM: 10_000 },
    });

    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect(mocks.markTripNotATrip).toHaveBeenCalledWith("user-1", "trip-1");
    expect(await response.json()).toMatchObject({ tripId: "trip-1", place: { id: "place-1" } });
  });

  it("인증되지 않은 요청은 서비스를 호출하지 않는다", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({
      user: null,
      error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });

    const response = await POST(request(), context);

    expect(response.status).toBe(401);
    expect(mocks.markTripNotATrip).not.toHaveBeenCalled();
  });

  it("다른 사용자 또는 없는 여행은 404로 숨긴다", async () => {
    mocks.markTripNotATrip.mockRejectedValue(new TripNotFoundError());

    const response = await POST(request(), context);

    expect(response.status).toBe(404);
  });

  it("방문 없는 여행은 삭제하지 않고 400을 반환한다", async () => {
    mocks.markTripNotATrip.mockRejectedValue(new TripHasNoVisitsError());

    const response = await POST(request(), context);

    expect(response.status).toBe(400);
  });
});
