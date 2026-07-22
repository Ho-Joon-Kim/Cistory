import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getSnapshot: vi.fn(),
  requestRecompute: vi.fn(),
  checkSameOrigin: vi.fn(),
}));

vi.mock("@/db", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/api-auth", () => ({ checkSameOrigin: mocks.checkSameOrigin }));
vi.mock("@/modules/overview/service", () => ({
  createDatabaseOverviewStore: vi.fn(() => ({})),
  createOverviewService: vi.fn(() => ({
    getSnapshot: mocks.getSnapshot,
    requestRecompute: mocks.requestRecompute,
  })),
}));
vi.mock("@/modules/overview/aggregate", () => {
  throw new Error("request routes must not import the aggregation pipeline");
});

import { POST } from "./recompute/route";
import { GET } from "./route";

describe("overview API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
      error: null,
    });
    mocks.checkSameOrigin.mockReturnValue({ ok: true });
    mocks.getSnapshot.mockResolvedValue({
      status: "missing",
      periodType: "month",
      periodKey: "2026-07",
    });
    mocks.requestRecompute.mockResolvedValue({
      status: "pending",
      periodType: "month",
      periodKey: "2026-07",
    });
  });

  it("authenticates GET and delegates a read-only snapshot lookup", async () => {
    const request = new NextRequest(
      "http://localhost/api/overview?periodType=month&periodKey=2026-07"
    );

    const response = await GET(request, undefined);

    expect(response.status).toBe(200);
    expect(mocks.getSnapshot).toHaveBeenCalledWith("user-1", "month", "2026-07");
    expect(mocks.requestRecompute).not.toHaveBeenCalled();
  });

  it("does not access the overview store when GET is unauthenticated", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({
      user: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await GET(new NextRequest("http://localhost/api/overview"), undefined);

    expect(response.status).toBe(401);
    expect(mocks.getSnapshot).not.toHaveBeenCalled();
  });

  it("enqueues a same-origin recompute request", async () => {
    const request = new NextRequest("http://localhost/api/overview/recompute", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ periodType: "month", periodKey: "2026-07" }),
    });

    const response = await POST(request, undefined);

    expect(response.status).toBe(202);
    expect(mocks.requestRecompute).toHaveBeenCalledWith("user-1", "month", "2026-07");
  });

  it("rejects an invalid recompute body before touching the store", async () => {
    const request = new NextRequest("http://localhost/api/overview/recompute", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ periodType: "month" }),
    });

    const response = await POST(request, undefined);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "VALIDATION" });
    expect(mocks.requestRecompute).not.toHaveBeenCalled();
  });

  it("rejects cross-origin recompute before touching the store", async () => {
    mocks.checkSameOrigin.mockReturnValue({ ok: false, reason: "not allowed" });
    const request = new NextRequest("http://localhost/api/overview/recompute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ periodType: "month", periodKey: "2026-07" }),
    });

    const response = await POST(request, undefined);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_ORIGIN" });
    expect(mocks.requestRecompute).not.toHaveBeenCalled();
  });
});
