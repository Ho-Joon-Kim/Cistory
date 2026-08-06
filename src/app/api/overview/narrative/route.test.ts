import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  checkSameOrigin: vi.fn(),
  get: vi.fn(),
  regenerate: vi.fn(),
  createClaudeAdapter: vi.fn(() => ({ generateText: vi.fn() })),
}));

vi.mock("@/db", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/api-auth", () => ({ checkSameOrigin: mocks.checkSameOrigin }));
vi.mock("@/lib/adapters/ai/claude", () => ({
  createClaudeAdapter: mocks.createClaudeAdapter,
  CLAUDE_MODELS: { COMMIT_SUMMARY: "claude-sonnet-5", NARRATIVE: "claude-opus-5" },
}));
vi.mock("@/modules/overview/narrative", () => ({
  createDatabaseNarrativeStore: vi.fn(() => ({})),
  createNarrativeService: vi.fn(() => ({ get: mocks.get, regenerate: mocks.regenerate })),
}));
vi.mock("@/modules/overview/aggregate", () => {
  throw new Error("narrative routes must not import aggregation");
});

import { GET, POST } from "./route";

describe("overview narrative API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
    mocks.getAuthenticatedUser.mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
      error: null,
    });
    mocks.checkSameOrigin.mockReturnValue({ ok: true });
    mocks.get.mockResolvedValue({ status: "missing", periodType: "month", periodKey: "2026-06" });
    mocks.regenerate.mockResolvedValue({
      status: "ready",
      periodType: "month",
      periodKey: "2026-06",
      content: "회고",
    });
  });

  it("reads only the authenticated user's stored narrative", async () => {
    const request = new NextRequest(
      "http://localhost/api/overview/narrative?periodType=month&periodKey=2026-06"
    );
    const response = await GET(request, undefined);

    expect(response.status).toBe(200);
    expect(mocks.get).toHaveBeenCalledWith("user-1", "month", "2026-06");
    expect(mocks.regenerate).not.toHaveBeenCalled();
  });

  it("returns 401 before reading when unauthenticated", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({
      user: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const response = await GET(
      new NextRequest("http://localhost/api/overview/narrative"),
      undefined
    );

    expect(response.status).toBe(401);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("regenerates after validation and same-origin checks", async () => {
    const request = new NextRequest("http://localhost/api/overview/narrative", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ periodType: "month", periodKey: "2026-06" }),
    });
    const response = await POST(request, undefined);

    expect(response.status).toBe(200);
    expect(mocks.regenerate).toHaveBeenCalledWith("user-1", "month", "2026-06");
  });

  it("rejects invalid bodies before generation", async () => {
    const request = new NextRequest("http://localhost/api/overview/narrative", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ periodType: "month" }),
    });
    const response = await POST(request, undefined);

    expect(response.status).toBe(400);
    expect(mocks.regenerate).not.toHaveBeenCalled();
  });

  it("rejects cross-origin generation", async () => {
    mocks.checkSameOrigin.mockReturnValue({ ok: false, reason: "not allowed" });
    const request = new NextRequest("http://localhost/api/overview/narrative", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ periodType: "month", periodKey: "2026-06" }),
    });
    const response = await POST(request, undefined);

    expect(response.status).toBe(403);
    expect(mocks.regenerate).not.toHaveBeenCalled();
  });
});
