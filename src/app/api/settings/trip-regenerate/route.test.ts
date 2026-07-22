import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  regenerateTrips: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/modules/location/services/trip-detector", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/location/services/trip-detector")>();
  return { ...actual, regenerateTrips: mocks.regenerateTrips };
});

import { POST } from "./route";

function request(body: string): NextRequest {
  return new NextRequest("http://localhost/api/settings/trip-regenerate", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/settings/trip-regenerate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue({ user: { id: "user-1" }, error: null });
    mocks.regenerateTrips.mockResolvedValue({ detected: 3, inserted: 3, replaced: 2, skipped: 1 });
  });

  it("requires authentication", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({
      user: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await POST(request("{}"));

    expect(response.status).toBe(401);
    expect(mocks.regenerateTrips).not.toHaveBeenCalled();
  });

  it("defaults to the complete supported history through today", async () => {
    const response = await POST(request("{}"));

    expect(response.status).toBe(200);
    expect(mocks.regenerateTrips).toHaveBeenCalledWith(
      "user-1",
      "2025-03-08",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
    );
    await expect(response.json()).resolves.toMatchObject({ ok: true, inserted: 3, replaced: 2 });
  });

  it("accepts a validated explicit range", async () => {
    const response = await POST(request(JSON.stringify({ from: "2026-01-01", to: "2026-07-22" })));

    expect(response.status).toBe(200);
    expect(mocks.regenerateTrips).toHaveBeenCalledWith("user-1", "2026-01-01", "2026-07-22");
  });

  it("rejects malformed JSON and invalid dates without touching trips", async () => {
    const malformed = await POST(request("{bad"));
    expect(malformed.status).toBe(400);

    const invalid = await POST(request(JSON.stringify({ from: "2026-02-30", to: "2026-03-01" })));
    expect(invalid.status).toBe(400);
    expect(mocks.regenerateTrips).not.toHaveBeenCalled();
  });

  it("reports regeneration failures without claiming success", async () => {
    mocks.regenerateTrips.mockRejectedValue(new Error("candidate query failed"));

    const response = await POST(request("{}"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "여행 재생성에 실패했습니다" });
  });
});
