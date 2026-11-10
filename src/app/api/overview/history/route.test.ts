import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  findHistorySnapshots: vi.fn(),
}));

vi.mock("@/db", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/modules/overview/history-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/overview/history-store")>();
  return {
    ...actual,
    createDatabaseOverviewHistoryStore: vi.fn(() => ({
      findHistorySnapshots: mocks.findHistorySnapshots,
    })),
  };
});

import { GET } from "./route";

const get = (query: string) =>
  GET(new NextRequest(`http://localhost/api/overview/history?${query}`), undefined);

describe("GET /api/overview/history", () => {
  beforeEach(() => {
    mocks.getAuthenticatedUser.mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
      error: null,
    });
    mocks.findHistorySnapshots.mockResolvedValue([]);
  });

  it("returns 401 without reading snapshots when unauthenticated", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({
      user: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const response = await get("periodType=month&periodKey=2026-10");
    expect(response.status).toBe(401);
    expect(mocks.findHistorySnapshots).not.toHaveBeenCalled();
  });

  it("rejects recent, unknown types and non-canonical keys with 400", async () => {
    for (const query of [
      "periodType=recent&periodKey=2026-11-10",
      "periodType=day&periodKey=2026-11-10",
      "periodType=month&periodKey=2026-13",
      "periodType=month&periodKey=2026-1",
      "periodType=week&periodKey=2026-W99",
      "periodType=month",
    ]) {
      const response = await get(query);
      expect(response.status, query).toBe(400);
    }
    expect(mocks.findHistorySnapshots).not.toHaveBeenCalled();
  });

  it("returns the caller's history, never cached", async () => {
    const response = await get("periodType=month&periodKey=2026-10");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.findHistorySnapshots).toHaveBeenCalledWith("user-1", expect.any(Array));
    const body = await response.json();
    expect(body).toMatchObject({ periodType: "month", periodKey: "2026-10", previous: null });
    expect(body.series).toHaveLength(10);
  });
});
