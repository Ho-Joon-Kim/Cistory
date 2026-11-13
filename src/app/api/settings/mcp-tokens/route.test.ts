import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  sameOrigin: vi.fn(),
  rows: [] as Record<string, unknown>[],
  inserted: vi.fn(),
}));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.auth }));
vi.mock("@/lib/api-auth", () => ({ checkSameOrigin: mocks.sameOrigin }));
vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ orderBy: async () => mocks.rows }) }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        mocks.inserted(values);
        return {
          returning: async () => [{ id: "11111111-1111-4111-8111-111111111111", ...values }],
        };
      },
    }),
  }),
}));

import { GET, POST } from "./route";

const URL_BASE = "https://cistory.test/api/settings/mcp-tokens";
const post = (body: unknown) =>
  POST(
    new NextRequest(URL_BASE, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    undefined
  );
const RAW = /^cmcp_[0-9a-f]{12}_[0-9a-f]{64}$/;

beforeEach(() => {
  mocks.rows = [];
  mocks.auth.mockResolvedValue({ user: { id: "owner", email: null }, error: null });
  mocks.sameOrigin.mockReturnValue({ ok: true });
});

describe("POST /api/settings/mcp-tokens", () => {
  it("returns the raw token once, with only its hash stored", async () => {
    const response = await post({ name: "노트북", scopes: ["read"], allowedCountries: ["kr"] });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const json = await response.json();
    expect(json.raw).toMatch(RAW);
    expect(json.token.prefix).toBe(`${json.raw.slice(0, 17)}_…`);
    expect(json.token.allowedCountries).toEqual(["KR"]);
    expect(json.token).not.toHaveProperty("secretHash");
    const stored = mocks.inserted.mock.calls[0][0];
    expect(Object.values(stored)).not.toContain(json.raw);
    expect(stored.secretHash).not.toBe(json.raw.slice(18));
    expect(json.raw.slice(18)).toHaveLength(64);
  });

  it("answers 400 with a Korean message for an invalid CIDR, before writing", async () => {
    const response = await post({ name: "x", scopes: ["read"], allowedCidrs: ["300.1.2.3/8"] });
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.code).toBe("MCP_TOKEN_CIDR_INVALID");
    expect(json.error).toMatch(/IP 범위/);
    expect(mocks.inserted).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request with 403 before writing", async () => {
    mocks.sameOrigin.mockReturnValue({ ok: false, reason: "origin" });
    const response = await post({ name: "x", scopes: ["read"] });
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.inserted).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    mocks.auth.mockResolvedValue({
      user: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    expect((await post({ name: "x", scopes: ["read"] })).status).toBe(401);
    expect(mocks.inserted).not.toHaveBeenCalled();
  });

  it("rejects a past expiry in Korean", async () => {
    const response = await post({ name: "x", scopes: ["read"], expiresAt: "2001-01-01T00:00:00Z" });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("MCP_TOKEN_EXPIRY_INVALID");
  });
});

describe("GET /api/settings/mcp-tokens", () => {
  it("lists tokens with a prefix only, never the secret or raw token", async () => {
    const created = new Date("2026-11-01T00:00:00Z");
    mocks.rows = [
      {
        id: "22222222-2222-4222-8222-222222222222",
        userId: "owner",
        name: "서버",
        lookupId: "abcdef012345",
        secretHash: "f".repeat(64),
        scopes: ["read", "write"],
        allowedCidrs: ["0.0.0.0/0"],
        allowedCountries: [],
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: created,
        updatedAt: created,
      },
    ];
    const response = await GET(new NextRequest(URL_BASE), undefined);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const text = await response.text();
    expect(text).not.toContain("f".repeat(64));
    expect(text).not.toContain("raw");
    const { tokens } = JSON.parse(text);
    expect(tokens[0]).toMatchObject({
      prefix: "cmcp_abcdef012345_…",
      status: "active",
      cidrLockIsCatchAll: true,
    });
  });

  it("answers 401 without a session", async () => {
    mocks.auth.mockResolvedValue({
      user: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    expect((await GET(new NextRequest(URL_BASE), undefined)).status).toBe(401);
  });
});
