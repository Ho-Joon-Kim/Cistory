import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  withTripWriteLock: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/modules/location/services/trip-writer", () => ({
  withTripWriteLock: mocks.withTripWriteLock,
}));

import { PUT } from "./route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/saved-places/place-1", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const context = { params: Promise.resolve({ id: "place-1" }) };

describe("PUT /api/saved-places/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue({ user: { id: "user-1" }, error: null });
    mocks.withTripWriteLock.mockImplementation(
      async (_userId: string, operation: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const tx = {
          update: () => ({
            set: (updates: Record<string, unknown>) => ({
              where: () => ({ returning: async () => [{ id: "place-1", ...updates }] }),
            }),
          }),
        };
        return operation(tx);
      }
    );
  });

  it("제외 토글과 반경을 사용자 여행 잠금 안에서 갱신한다", async () => {
    const response = await PUT(
      request({ excludeFromTrips: true, tripExclusionRadiusM: 15_000 }),
      context
    );

    expect(response.status).toBe(200);
    expect(mocks.withTripWriteLock).toHaveBeenCalledWith("user-1", expect.any(Function));
    expect(await response.json()).toMatchObject({
      place: { excludeFromTrips: true, tripExclusionRadiusM: 15_000 },
    });
  });

  it("제외 토글 boolean과 반경 1~100km 범위를 검증한다", async () => {
    expect((await PUT(request({ excludeFromTrips: "yes" }), context)).status).toBe(400);
    expect((await PUT(request({ tripExclusionRadiusM: 999 }), context)).status).toBe(400);
    expect((await PUT(request({ tripExclusionRadiusM: 100_001 }), context)).status).toBe(400);
    expect(mocks.withTripWriteLock).not.toHaveBeenCalled();
  });

  it("다른 사용자의 장소는 404를 반환한다", async () => {
    mocks.withTripWriteLock.mockResolvedValue(null);

    const response = await PUT(request({ excludeFromTrips: false }), context);

    expect(response.status).toBe(404);
  });
});
