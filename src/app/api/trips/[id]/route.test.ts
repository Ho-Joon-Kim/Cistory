import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getTripDetail: vi.fn(),
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db")>();
  return { ...actual, getDb: mocks.getDb };
});
vi.mock("@/modules/travel/service", () => ({
  TravelService: class {
    getTripDetail = mocks.getTripDetail;
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

import { GET } from "./route";

function request() {
  return new NextRequest("http://localhost/api/trips/trip-1");
}

function context(id = "trip-1") {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/trips/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue({ user: { id: "user-1" }, error: null });
  });

  it("passes only the authenticated user id and trip id to the detail service", async () => {
    const detail = { trip: { id: "trip-1" }, visits: [], health: [] };
    mocks.getTripDetail.mockResolvedValue(detail);

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(detail);
    expect(mocks.getTripDetail).toHaveBeenCalledWith("user-1", "trip-1");
  });

  it("returns 404 for a missing or cross-user trip", async () => {
    mocks.getTripDetail.mockResolvedValue(null);

    const response = await GET(request(), context("other-trip"));

    expect(response.status).toBe(404);
  });
});
