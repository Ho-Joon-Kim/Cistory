import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  sameOrigin: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.auth }));
vi.mock("@/lib/api-auth", () => ({ checkSameOrigin: mocks.sameOrigin }));
vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: () => ({}),
}));
vi.mock("@/modules/mcp/audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/mcp/audit")>()),
  listAuditLog: mocks.list,
  deleteAuditLog: mocks.remove,
}));

import { McpAuditCursorError, McpAuditDeleteScopeError } from "@/modules/mcp/audit";
import { DELETE, GET } from "./route";

const BASE = "https://cistory.test/api/settings/mcp-tokens/audit";
const TOKEN = "44444444-4444-4444-8444-444444444444";
const get = (query = "") => GET(new NextRequest(`${BASE}${query}`), undefined);
const del = (body: unknown) =>
  DELETE(new NextRequest(BASE, { method: "DELETE", body: JSON.stringify(body) }), undefined);
const unauthenticated = () =>
  mocks.auth.mockResolvedValue({
    user: null,
    error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  });

beforeEach(() => {
  mocks.auth.mockResolvedValue({ user: { id: "owner", email: null }, error: null });
  mocks.sameOrigin.mockReturnValue({ ok: true });
  mocks.list.mockResolvedValue({ items: [], nextCursor: null });
  mocks.remove.mockResolvedValue(3);
});

describe("GET /api/settings/mcp-tokens/audit", () => {
  it("maps KST day keys to instant bounds and passes the filters", async () => {
    const response = await get(
      `?tokenId=${TOKEN}&tool=search_records&outcome=denied&from=2026-11-01&to=2026-11-02&limit=20&cursor=abc`
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.list).toHaveBeenCalledWith(expect.anything(), "owner", {
      tokenId: TOKEN,
      tool: "search_records",
      outcome: "denied",
      from: new Date("2026-10-31T15:00:00Z"),
      to: new Date("2026-11-02T15:00:00Z"),
      cursor: "abc",
      limit: 20,
    });
  });

  it("ignores empty params", async () => {
    await get("?tokenId=&tool=&outcome=");
    expect(mocks.list).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      expect.objectContaining({ tokenId: undefined, tool: undefined, outcome: undefined })
    );
  });

  it("400s a bad cursor, a bad outcome and an inverted range", async () => {
    mocks.list.mockRejectedValue(new McpAuditCursorError());
    expect((await get("?cursor=zz")).status).toBe(400);
    expect((await get("?outcome=maybe")).status).toBe(400);
    const inverted = await get("?from=2026-11-05&to=2026-11-01");
    expect(inverted.status).toBe(400);
    expect((await inverted.json()).error).toBe("시작일이 종료일보다 늦습니다.");
  });

  it("answers 401 without a session", async () => {
    unauthenticated();
    expect((await get()).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/settings/mcp-tokens/audit", () => {
  it("deletes by range and token", async () => {
    const response = await del({ from: "2026-11-01", to: "2026-11-01", tokenId: TOKEN });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 3 });
    expect(mocks.remove).toHaveBeenCalledWith(expect.anything(), "owner", {
      tokenId: TOKEN,
      from: new Date("2026-10-31T15:00:00Z"),
      to: new Date("2026-11-01T15:00:00Z"),
    });
  });

  it("refuses an empty filter with a Korean 400", async () => {
    mocks.remove.mockRejectedValue(new McpAuditDeleteScopeError());
    const response = await del({});
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("삭제할 기간이나 토큰을 지정하세요.");
  });

  it("rejects cross-origin with 403", async () => {
    mocks.sameOrigin.mockReturnValue({ ok: false, reason: "origin" });
    expect((await del({ tokenId: TOKEN })).status).toBe(403);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    unauthenticated();
    expect((await del({ tokenId: TOKEN })).status).toBe(401);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
