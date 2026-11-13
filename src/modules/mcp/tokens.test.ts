import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import type { McpToken } from "@/db/schema";
import {
  bearerToken,
  generateRawToken,
  hashSecret,
  hasScope,
  McpTokenValidationError,
  normalizeTokenSettings,
  parseRawToken,
  toTokenSummary,
  verifyToken,
} from "./tokens";

const NOW = new Date("2026-11-13T03:00:00.000Z");

function row(overrides: Partial<McpToken> = {}): McpToken {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    name: "agent",
    lookupId: "abcdef012345",
    secretHash: hashSecret("a".repeat(64)),
    scopes: ["read"],
    allowedCidrs: ["203.0.113.0/24"],
    allowedCountries: ["KR"],
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** Minimal db double: records each lookup id the verifier queried. */
function fakeDb(rows: McpToken[]) {
  const queried: number[] = [];
  const update = vi.fn(() => ({ set: () => ({ where: async () => undefined }) }));
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            queried.push(1);
            return rows;
          },
        }),
      }),
    }),
    update,
  };
  return { db: db as unknown as Database, queried, update };
}

describe("token format", () => {
  it("generates cmcp_<12 hex>_<64 hex> from fresh randomness", () => {
    const a = generateRawToken();
    const b = generateRawToken();
    expect(a.raw).toMatch(/^cmcp_[0-9a-f]{12}_[0-9a-f]{64}$/);
    expect(a.raw).not.toBe(b.raw);
    expect(parseRawToken(a.raw)).toEqual({ lookupId: a.lookupId, secret: a.secret });
  });

  it("parses only the exact shape", () => {
    for (const bad of [
      "",
      null,
      42,
      "cmcp_abc_def",
      `cmcp_ABCDEF012345_${"a".repeat(64)}`,
      `cmcp_abcdef012345_${"a".repeat(63)}`,
      `xmcp_abcdef012345_${"a".repeat(64)}`,
      ` cmcp_abcdef012345_${"a".repeat(64)}`,
    ]) {
      expect(parseRawToken(bad)).toBeNull();
    }
  });

  it("reads bearer tokens", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer   abc ")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});

describe("normalizeTokenSettings", () => {
  it("normalizes scopes, CIDRs and countries", () => {
    const settings = normalizeTokenSettings(
      {
        name: "  laptop agent ",
        scopes: ["write", "read", "read"],
        allowedCidrs: ["::ffff:192.168.0.0/120", "10.1.2.3/8", "10.0.0.0/8"],
        allowedCountries: ["kr", "US"],
      },
      NOW
    );
    expect(settings).toEqual({
      name: "laptop agent",
      scopes: ["read", "write"],
      allowedCidrs: ["192.168.0.0/24", "10.0.0.0/8"],
      allowedCountries: ["KR", "US"],
      expiresAt: null,
    });
  });

  it("allows sensitive-read or write without read", () => {
    expect(normalizeTokenSettings({ name: "x", scopes: ["sensitive-read"] }, NOW).scopes).toEqual([
      "sensitive-read",
    ]);
  });

  it("stores catch-all CIDRs (the UI warns; they aren't rejected)", () => {
    const settings = normalizeTokenSettings(
      { name: "x", scopes: ["read"], allowedCidrs: ["0.0.0.0/0", "::/0"] },
      NOW
    );
    expect(settings.allowedCidrs).toEqual(["0.0.0.0/0", "::/0"]);
  });

  it.each([
    [{ name: "x", scopes: ["read"], allowedCidrs: ["10.0.0.0/33"] }, "MCP_TOKEN_CIDR_INVALID"],
    [{ name: "x", scopes: ["read"], allowedCountries: ["XX"] }, "MCP_TOKEN_COUNTRY_INVALID"],
    [{ name: "x", scopes: ["read"], allowedCountries: ["T1"] }, "MCP_TOKEN_COUNTRY_INVALID"],
    [{ name: "x", scopes: ["read"], allowedCountries: ["KOR"] }, "MCP_TOKEN_COUNTRY_INVALID"],
    [{ name: "x", scopes: ["admin"] }, "MCP_TOKEN_SCOPES_INVALID"],
    [{ name: "x", scopes: [] }, "MCP_TOKEN_SCOPES_INVALID"],
    [{ name: "  ", scopes: ["read"] }, "MCP_TOKEN_NAME_INVALID"],
    [
      { name: "x", scopes: ["read"], expiresAt: new Date(NOW.getTime() - 1) },
      "MCP_TOKEN_EXPIRY_INVALID",
    ],
  ])("rejects %j with %s", (input, code) => {
    try {
      normalizeTokenSettings(input, NOW);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(McpTokenValidationError);
      expect((error as McpTokenValidationError).code).toBe(code);
      expect((error as McpTokenValidationError).status).toBe(400);
    }
  });
});

describe("verifyToken", () => {
  const secret = "a".repeat(64);
  const raw = `cmcp_abcdef012345_${secret}`;

  it("returns scopes and locks for a valid token", async () => {
    const { db } = fakeDb([row()]);
    const result = await verifyToken(db, raw, NOW);
    expect(result).toEqual({
      ok: true,
      token: {
        tokenId: row().id,
        userId: row().userId,
        name: "agent",
        scopes: ["read"],
        cidrs: ["203.0.113.0/24"],
        countries: ["KR"],
      },
    });
  });

  it("queries even for malformed / empty / missing input and gives one reason", async () => {
    for (const input of ["", null, undefined, "garbage", "cmcp_x_y"]) {
      const { db, queried } = fakeDb([]);
      expect(await verifyToken(db, input, NOW)).toEqual({
        ok: false,
        reason: "token_unrecognized",
      });
      expect(queried).toHaveLength(1);
    }
    const { db } = fakeDb([]);
    expect(await verifyToken(db, `cmcp_000000000000_${secret}`, NOW)).toEqual({
      ok: false,
      reason: "token_unrecognized",
    });
  });

  it("rejects a right lookup id with a wrong secret the same way", async () => {
    const { db } = fakeDb([row()]);
    expect(await verifyToken(db, `cmcp_abcdef012345_${"b".repeat(64)}`, NOW)).toEqual({
      ok: false,
      reason: "token_unrecognized",
    });
  });

  it("distinguishes revoked and expired for the audit log", async () => {
    const revoked = fakeDb([row({ revokedAt: NOW })]);
    expect(await verifyToken(revoked.db, raw, NOW)).toMatchObject({
      ok: false,
      reason: "token_revoked",
      tokenId: row().id,
    });
    const expired = fakeDb([row({ expiresAt: NOW })]);
    expect(await verifyToken(expired.db, raw, NOW)).toMatchObject({
      ok: false,
      reason: "token_expired",
      userId: row().userId,
    });
  });

  it("throttles the last_used_at write to once a minute", async () => {
    const recent = fakeDb([row({ lastUsedAt: new Date(NOW.getTime() - 30_000) })]);
    await verifyToken(recent.db, raw, NOW);
    expect(recent.update).not.toHaveBeenCalled();
    const stale = fakeDb([row({ lastUsedAt: new Date(NOW.getTime() - 61_000) })]);
    await verifyToken(stale.db, raw, NOW);
    expect(stale.update).toHaveBeenCalledOnce();
  });

  it("still authenticates when the last_used_at write fails", async () => {
    const { db } = fakeDb([row({ lastUsedAt: null })]);
    (db as unknown as { update: unknown }).update = () => ({
      set: () => ({ where: async () => Promise.reject(new Error("db down")) }),
    });
    expect((await verifyToken(db, raw, NOW)).ok).toBe(true);
  });
});

describe("toTokenSummary", () => {
  it("never exposes the secret hash and flags catch-all locks", () => {
    const summary = toTokenSummary(row({ allowedCidrs: ["0.0.0.0/0"] }), NOW);
    expect(JSON.stringify(summary)).not.toContain(row().secretHash);
    expect(summary.prefix).toBe("cmcp_abcdef012345_…");
    expect(summary.cidrLockIsCatchAll).toBe(true);
    expect(summary.status).toBe("active");
    expect(toTokenSummary(row({ revokedAt: NOW }), NOW).status).toBe("revoked");
    expect(toTokenSummary(row({ expiresAt: NOW }), NOW).status).toBe("expired");
  });
});

describe("hasScope", () => {
  it("treats each scope independently", () => {
    expect(hasScope(["sensitive-read"], "read")).toBe(false);
    expect(hasScope(["read", "write"], "write")).toBe(true);
  });
});
