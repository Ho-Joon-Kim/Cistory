import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), search: vi.fn(), db: {} }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.auth }));
vi.mock("@/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/modules/search/service", () => ({ searchRecords: mocks.search }));

import { GET } from "./route";

const get = (query = "") => GET(new NextRequest(`http://localhost/api/search?${query}`), undefined);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner", email: null }, error: null });
  mocks.search.mockResolvedValue({ items: [], page: 1, hasMore: false });
});
describe("record search API", () => {
  it("requires authentication before reading records", async () => {
    mocks.auth.mockResolvedValue({
      user: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    expect((await get()).status).toBe(401);
    expect(mocks.search).not.toHaveBeenCalled();
  });
  it("scopes records to the authenticated owner and disables caching", async () => {
    const response = await get("userId=other&from=2026-09-01&to=2026-09-02&q=hello&source=visit");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.search).toHaveBeenCalledWith(mocks.db, "owner", {
      from: "2026-09-01",
      to: "2026-09-02",
      q: "hello",
      source: "visit",
      page: 1,
    });
  });
  it("rejects an invalid range before touching the database", async () => {
    expect((await get("from=2026-02-30")).status).toBe(400);
    expect(mocks.search).not.toHaveBeenCalled();
  });
  it("returns a safe failure without provider error details", async () => {
    mocks.search.mockRejectedValue(new Error("private database detail"));
    const response = await get();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private database detail");
  });
});
