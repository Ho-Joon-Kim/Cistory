import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { mcpTokens } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import {
  issueToken,
  listTokens,
  parseRawToken,
  revokeToken,
  rotateToken,
  verifyToken,
} from "./tokens";

// Committed rows on a pool (not the BEGIN/ROLLBACK harness): rotateToken opens
// its own transaction, which a single already-in-transaction client can't nest.
// Every row hangs off a user created here and is removed by the users cascade.
describe("MCP tokens against PostgreSQL", () => {
  let pool: Pool;
  let db: Database;
  const created: string[] = [];

  beforeAll(() => {
    if (!process.env.TEST_DATABASE_URL) throw new Error("Use disposable TEST_DATABASE_URL only");
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
    db = drizzle(pool, { schema }) as unknown as Database;
  });
  afterEach(async () => {
    if (created.length > 0) {
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [created.splice(0)]);
    }
  });
  afterAll(async () => {
    await pool?.end();
  });

  async function user(): Promise<string> {
    const id = await insertTestUser(db as never);
    created.push(id);
    return id;
  }

  const T0 = new Date("2026-11-13T03:00:00.000Z");

  it("issues a token that verifies with its scopes and locks, storing no secret", async () => {
    const userId = await user();
    const { raw, token } = await issueToken(
      db,
      userId,
      {
        name: "agent",
        scopes: ["read", "sensitive-read"],
        allowedCidrs: ["::ffff:192.168.0.0/120"],
        allowedCountries: ["kr"],
      },
      T0
    );
    expect(raw).toMatch(/^cmcp_[0-9a-f]{12}_[0-9a-f]{64}$/);
    expect(token.allowedCidrs).toEqual(["192.168.0.0/24"]);

    const result = await verifyToken(db, raw, T0);
    expect(result).toEqual({
      ok: true,
      token: {
        tokenId: token.id,
        userId,
        name: "agent",
        scopes: ["read", "sensitive-read"],
        cidrs: ["192.168.0.0/24"],
        countries: ["KR"],
      },
    });

    // The raw token and its secret appear nowhere in the stored row.
    const secret = parseRawToken(raw)?.secret ?? "";
    const dump = await pool.query("SELECT t::text AS row FROM mcp_tokens t WHERE id = $1", [
      token.id,
    ]);
    expect(dump.rows[0].row).not.toContain(secret);
    expect(dump.rows[0].row).not.toContain(raw);
  });

  it("rejects a duplicate lookup_id", async () => {
    const userId = await user();
    const row = {
      userId,
      name: "dup",
      lookupId: "0123456789ab",
      secretHash: "x",
      scopes: ["read" as const],
      createdAt: T0,
      updatedAt: T0,
    };
    await db.insert(mcpTokens).values(row);
    await expect(db.insert(mcpTokens).values(row)).rejects.toMatchObject({
      cause: { code: "23505" },
    });
    await pool.query("DELETE FROM mcp_tokens WHERE lookup_id = $1", ["0123456789ab"]);
  });

  it("updates last_used_at at most once a minute", async () => {
    const userId = await user();
    const { raw, token } = await issueToken(db, userId, { name: "a", scopes: ["read"] }, T0);
    const lastUsed = async () =>
      (await pool.query("SELECT last_used_at FROM mcp_tokens WHERE id = $1", [token.id])).rows[0]
        .last_used_at as Date | null;
    const changes: (Date | null)[] = [];

    await verifyToken(db, raw, T0);
    changes.push(await lastUsed());
    await verifyToken(db, raw, new Date(T0.getTime() + 20_000));
    await verifyToken(db, raw, new Date(T0.getTime() + 40_000));
    changes.push(await lastUsed());
    await verifyToken(db, raw, new Date(T0.getTime() + 61_000));
    changes.push(await lastUsed());

    expect(changes.map((value) => value?.getTime() ?? null)).toEqual([
      changes[0]?.getTime(),
      changes[0]?.getTime(),
      (changes[0]?.getTime() ?? 0) + 61_000,
    ]);
    // Stored as UTC wall time (pg reads the timestamp back as local time, so
    // compare the text form rather than the Date).
    const text = await pool.query("SELECT last_used_at::text AS t FROM mcp_tokens WHERE id = $1", [
      token.id,
    ]);
    expect(text.rows[0].t).toBe("2026-11-13 03:01:01");
  });

  it("rotation revokes the old token and keeps the settings", async () => {
    const userId = await user();
    const expiresAt = new Date(T0.getTime() + 86_400_000);
    const first = await issueToken(
      db,
      userId,
      { name: "laptop", scopes: ["write"], allowedCountries: ["KR"], expiresAt },
      T0
    );
    const second = await rotateToken(db, userId, first.token.id, T0);

    expect(await verifyToken(db, first.raw, T0)).toMatchObject({
      ok: false,
      reason: "token_revoked",
      tokenId: first.token.id,
    });
    const verified = await verifyToken(db, second.raw, T0);
    expect(verified).toMatchObject({
      ok: true,
      token: { name: "laptop", scopes: ["write"], countries: ["KR"], cidrs: [] },
    });
    expect(second.token.expiresAt?.getTime()).toBe(expiresAt.getTime());
    await expect(rotateToken(db, userId, first.token.id, T0)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("revocation and expiry are distinguished; other users can't revoke", async () => {
    const userId = await user();
    const other = await user();
    const { raw, token } = await issueToken(
      db,
      userId,
      { name: "short", scopes: ["read"], expiresAt: new Date(T0.getTime() + 1000) },
      T0
    );
    expect(await verifyToken(db, raw, new Date(T0.getTime() + 1000))).toMatchObject({
      ok: false,
      reason: "token_expired",
    });

    expect(await revokeToken(db, other, token.id, T0)).toBe(false);
    expect((await verifyToken(db, raw, T0)).ok).toBe(true);
    expect(await revokeToken(db, userId, token.id, T0)).toBe(true);
    expect(await verifyToken(db, raw, T0)).toMatchObject({ reason: "token_revoked" });

    const listed = await listTokens(db, userId, T0);
    expect(listed).toHaveLength(1);
    expect(listed[0].status).toBe("revoked");
    expect(JSON.stringify(listed)).not.toContain(parseRawToken(raw)?.secret ?? "unreachable");
  });
});
