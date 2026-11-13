import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  sameOrigin: vi.fn(),
  rotate: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.auth }));
vi.mock("@/lib/api-auth", () => ({ checkSameOrigin: mocks.sameOrigin }));
vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: () => ({}),
}));
vi.mock("@/modules/mcp/tokens", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/mcp/tokens")>()),
  rotateToken: mocks.rotate,
  revokeToken: mocks.revoke,
}));

import { McpTokenNotFoundError } from "@/modules/mcp/tokens";
import { DELETE, POST } from "./route";

const ID = "33333333-3333-4333-8333-333333333333";
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
const url = (id = ID) => `https://cistory.test/api/settings/mcp-tokens/${id}`;
const rotate = (body: unknown = { action: "rotate" }, id = ID) =>
  POST(new NextRequest(url(id), { method: "POST", body: JSON.stringify(body) }), ctx(id));
const revoke = (id = ID) => DELETE(new NextRequest(url(id), { method: "DELETE" }), ctx(id));

beforeEach(() => {
  mocks.auth.mockResolvedValue({ user: { id: "owner", email: null }, error: null });
  mocks.sameOrigin.mockReturnValue({ ok: true });
});

describe("POST /api/settings/mcp-tokens/:id (rotate)", () => {
  it("returns the new raw token once", async () => {
    mocks.rotate.mockResolvedValue({ raw: "cmcp_new", token: { id: "new", prefix: "cmcp_…" } });
    const response = await rotate();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      raw: "cmcp_new",
      token: { id: "new", prefix: "cmcp_…" },
    });
    expect(mocks.rotate).toHaveBeenCalledWith(expect.anything(), "owner", ID);
  });

  it("rejects an unknown action", async () => {
    expect((await rotate({ action: "nope" })).status).toBe(400);
    expect(mocks.rotate).not.toHaveBeenCalled();
  });

  it("404s a token that isn't the caller's (or is gone)", async () => {
    mocks.rotate.mockRejectedValue(new McpTokenNotFoundError());
    const response = await rotate();
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("토큰을 찾을 수 없습니다.");
  });

  it("404s a malformed id without querying", async () => {
    expect((await rotate(undefined, "not-a-uuid")).status).toBe(404);
    expect(mocks.rotate).not.toHaveBeenCalled();
  });

  it("rejects cross-origin with 403", async () => {
    mocks.sameOrigin.mockReturnValue({ ok: false, reason: "origin" });
    expect((await rotate()).status).toBe(403);
    expect(mocks.rotate).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    mocks.auth.mockResolvedValue({
      user: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    expect((await rotate()).status).toBe(401);
    expect(mocks.rotate).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/settings/mcp-tokens/:id (revoke)", () => {
  it("revokes and never returns a raw token", async () => {
    mocks.revoke.mockResolvedValue(true);
    const response = await revoke();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: true });
    expect(mocks.revoke).toHaveBeenCalledWith(expect.anything(), "owner", ID);
  });

  it("404s when the token doesn't exist", async () => {
    mocks.revoke.mockResolvedValue(false);
    expect((await revoke()).status).toBe(404);
  });

  it("rejects cross-origin with 403", async () => {
    mocks.sameOrigin.mockReturnValue({ ok: false, reason: "origin" });
    expect((await revoke()).status).toBe(403);
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    mocks.auth.mockResolvedValue({
      user: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    expect((await revoke()).status).toBe(401);
  });
});
