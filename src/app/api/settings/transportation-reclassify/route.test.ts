import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  reclassifyTransportationRange: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn() },
}));

vi.mock("@/modules/location/services/transportation/reclassify", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/location/services/transportation/reclassify")>();
  return { ...actual, reclassifyTransportationRange: mocks.reclassifyTransportationRange };
});

import {
  TransportationReclassificationError,
  TransportationReclassificationValidationError,
} from "@/modules/location/services/transportation/reclassify";
import { POST } from "./route";

function request(body: string): NextRequest {
  return new NextRequest("http://localhost/api/settings/transportation-reclassify", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/settings/transportation-reclassify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue({ user: { id: "user-1" }, error: null });
  });

  it("requires authentication", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({
      user: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await POST(request(JSON.stringify({ from: "2026-07-01", to: "2026-07-02" })));

    expect(response.status).toBe(401);
    expect(mocks.reclassifyTransportationRange).not.toHaveBeenCalled();
  });

  it("passes only the authenticated user and requested range to the service", async () => {
    mocks.reclassifyTransportationRange.mockResolvedValue({
      from: "2026-07-01",
      to: "2026-07-02",
      daysProcessed: 2,
      trackCount: 3,
      segmentCount: 8,
    });

    const response = await POST(
      request(JSON.stringify({ userId: "attacker", from: "2026-07-01", to: "2026-07-02" }))
    );

    expect(response.status).toBe(200);
    expect(mocks.reclassifyTransportationRange).toHaveBeenCalledWith(
      "user-1",
      "2026-07-01",
      "2026-07-02"
    );
    await expect(response.json()).resolves.toMatchObject({ ok: true, daysProcessed: 2 });
  });

  it("returns validation failures as 400 responses", async () => {
    mocks.reclassifyTransportationRange.mockRejectedValue(
      new TransportationReclassificationValidationError("유효하지 않은 날짜입니다")
    );

    const response = await POST(request(JSON.stringify({ from: "2026-02-30", to: "2026-03-01" })));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "유효하지 않은 날짜입니다" });
  });

  it("returns malformed JSON as a 400 response", async () => {
    const response = await POST(request("{invalid"));

    expect(response.status).toBe(400);
    expect(mocks.reclassifyTransportationRange).not.toHaveBeenCalled();
  });

  it("exposes the failed date and partial progress when reclassification fails", async () => {
    mocks.reclassifyTransportationRange.mockRejectedValue(
      new TransportationReclassificationError(
        "2026-07-02",
        { daysProcessed: 1, trackCount: 2, segmentCount: 3 },
        new Error("database unavailable")
      )
    );

    const response = await POST(request(JSON.stringify({ from: "2026-07-01", to: "2026-07-03" })));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "2026-07-02 재분류에 실패했습니다",
      failedDate: "2026-07-02",
      daysProcessed: 1,
      trackCount: 2,
      segmentCount: 3,
    });
  });
});
