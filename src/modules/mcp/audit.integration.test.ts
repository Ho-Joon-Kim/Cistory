import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { mcpAlertState, mcpAuditLog, mcpIdempotency, mcpTokens } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import {
  deleteAuditLog,
  listAuditLog,
  McpAuditError,
  recordDenial,
  recordReadCall,
  recordUnauthenticatedDenial,
  recordWriteAudit,
  recordWriteFailure,
} from "./audit";
import { pruneExpiredIdempotencyKeys } from "./idempotency";
import { issueToken } from "./tokens";

// Committed rows on a pool: the write-rollback case needs a real transaction,
// and the aggregated-denial case needs concurrent connections. User-owned rows
// go with the users cascade; unattributed (user_id NULL) rows are removed by
// their unique test IPs.
describe("MCP audit log against PostgreSQL", () => {
  let pool: Pool;
  let db: Database;
  const createdUsers: string[] = [];
  const unauthIps: string[] = [];

  beforeAll(() => {
    if (!process.env.TEST_DATABASE_URL) throw new Error("Use disposable TEST_DATABASE_URL only");
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 8 });
    db = drizzle(pool, { schema }) as unknown as Database;
  });
  afterEach(async () => {
    if (createdUsers.length > 0) {
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [createdUsers.splice(0)]);
    }
    if (unauthIps.length > 0) {
      await pool.query("DELETE FROM mcp_audit_log WHERE ip = ANY($1::text[])", [
        unauthIps.splice(0),
      ]);
    }
  });
  afterAll(async () => {
    await pool?.end();
  });

  async function userWithToken() {
    const userId = await insertTestUser(db as never);
    createdUsers.push(userId);
    const { token } = await issueToken(db, userId, { name: "agent", scopes: ["read", "write"] });
    return {
      userId,
      tokenId: token.id,
      ctx: { userId, tokenId: token.id, ip: "203.0.113.9", country: "KR" },
    };
  }

  function testIp(): string {
    const ip = `2001:db8:${randomUUID().slice(0, 4)}::${randomUUID().slice(0, 4)}`;
    unauthIps.push(ip);
    return ip;
  }

  it("cascades every MCP table with the user, and keeps audit rows when a token is deleted", async () => {
    const { userId, tokenId, ctx } = await userWithToken();
    const now = new Date();
    const auditId = await recordReadCall(db, ctx, { tool: "spending", argsSummary: {} });
    await db.insert(mcpIdempotency).values({
      userId,
      tokenId,
      key: "k1",
      tool: "add_saved_place",
      argsHash: "h",
      result: { id: "x" },
      createdAt: now,
    });
    await db.insert(mcpAlertState).values({
      userId,
      tokenId,
      tokenKey: tokenId,
      reason: "ip_not_allowed",
      ip: "203.0.113.9",
      windowStart: now,
      createdAt: now,
      updatedAt: now,
    });

    // Token deleted: audit row survives with token_id NULL; idempotency goes; alert keeps its row.
    await db.delete(mcpTokens).where(eq(mcpTokens.id, tokenId));
    const [audit] = await db.select().from(mcpAuditLog).where(eq(mcpAuditLog.id, auditId));
    expect(audit.tokenId).toBeNull();
    expect(audit.userId).toBe(userId);
    expect(await db.select().from(mcpIdempotency).where(eq(mcpIdempotency.userId, userId))).toEqual(
      []
    );
    const [alert] = await db.select().from(mcpAlertState).where(eq(mcpAlertState.userId, userId));
    expect(alert.tokenId).toBeNull();

    // User deleted: everything goes.
    const { token: again } = await issueToken(db, userId, { name: "b", scopes: ["read"] });
    await db.insert(mcpIdempotency).values({
      userId,
      tokenId: again.id,
      key: "k2",
      tool: "t",
      argsHash: "h",
      result: {},
      createdAt: now,
    });
    await pool.query("DELETE FROM users WHERE id = $1", [userId]);
    for (const table of ["mcp_tokens", "mcp_audit_log", "mcp_idempotency", "mcp_alert_state"]) {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`,
        [userId]
      );
      expect({ table, n: rows[0].n }).toEqual({ table, n: 0 });
    }
  });

  it("stores `at` as UTC wall time, so KST-day filters don't shift by nine hours", async () => {
    const { userId, ctx } = await userWithToken();
    // 2026-11-14 00:30 KST.
    const at = new Date("2026-11-13T15:30:00.000Z");
    const auditId = await recordReadCall(db, ctx, { tool: "health", argsSummary: {}, at });
    const { rows } = await pool.query("SELECT at::text AS t FROM mcp_audit_log WHERE id = $1", [
      auditId,
    ]);
    expect(rows[0].t).toBe("2026-11-13 15:30:00");

    const kstDay = (day: string) => ({
      from: new Date(`${day}T00:00:00+09:00`),
      to: new Date(new Date(`${day}T00:00:00+09:00`).getTime() + 86_400_000),
    });
    const on14 = await listAuditLog(db, userId, kstDay("2026-11-14"));
    expect(on14.items.map((item) => item.id)).toContain(auditId);
    expect(on14.items.find((item) => item.id === auditId)?.at.toISOString()).toBe(at.toISOString());
    const on13 = await listAuditLog(db, userId, kstDay("2026-11-13"));
    expect(on13.items.map((item) => item.id)).not.toContain(auditId);
  });

  it("aggregates 100 unrecognized-token denials from one IP into one row per window", async () => {
    const ip = testIp();
    const base = new Date("2026-11-13T03:00:30.000Z");
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        recordUnauthenticatedDenial(db, {
          reason: "token_unrecognized",
          ip,
          country: "US",
          at: new Date(base.getTime() + i * 1000),
          ownerId: null,
        })
      )
    );
    expect(results.every(Boolean)).toBe(true);
    // Next window starts a new row.
    await recordUnauthenticatedDenial(db, {
      reason: "token_unrecognized",
      ip,
      country: "US",
      at: new Date("2026-11-13T03:15:00.000Z"),
      ownerId: null,
    });

    const { rows } = await pool.query(
      `SELECT hit_count, window_start::text AS w, user_id, token_id, outcome
       FROM mcp_audit_log WHERE ip = $1 ORDER BY window_start`,
      [ip]
    );
    expect(rows).toEqual([
      {
        hit_count: 100,
        w: "2026-11-13 03:00:00",
        user_id: null,
        token_id: null,
        outcome: "denied",
      },
      { hit_count: 1, w: "2026-11-13 03:15:00", user_id: null, token_id: null, outcome: "denied" },
    ]);
  });

  it("writes one row per recognized-token denial and shows unattributed rows to the owner", async () => {
    const { userId, tokenId } = await userWithToken();
    const ip = testIp();
    await recordDenial(db, { userId, tokenId, reason: "ip_not_allowed", ip, country: "JP" });
    await recordDenial(db, { userId, tokenId, reason: "ip_not_allowed", ip, country: "JP" });
    await recordUnauthenticatedDenial(db, {
      reason: "token_unrecognized",
      ip,
      country: "JP",
      ownerId: null,
    });

    const all = await listAuditLog(db, userId, { limit: 200, from: new Date(Date.now() - 60_000) });
    const mine = all.items.filter((item) => item.ip === ip);
    expect(mine.map((item) => item.denyReason).sort()).toEqual([
      "ip_not_allowed",
      "ip_not_allowed",
      "token_unrecognized",
    ]);
    const byToken = await listAuditLog(db, userId, { tokenId });
    expect(byToken.items.every((item) => item.tokenId === tokenId)).toBe(true);
    expect(byToken.items).toHaveLength(2);
  });

  it("pages with a stable cursor and deletes by token", async () => {
    const { userId, tokenId, ctx } = await userWithToken();
    const at = new Date("2026-11-10T00:00:00.000Z");
    for (let i = 0; i < 5; i++) {
      await recordReadCall(db, ctx, { tool: "work", argsSummary: { i }, at });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof listAuditLog>> = await listAuditLog(db, userId, {
        tokenId,
        limit: 2,
        cursor,
      });
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);

    expect(await deleteAuditLog(db, userId, { tokenId })).toBe(5);
    expect((await listAuditLog(db, userId, { tokenId })).items).toEqual([]);
  });

  it("rolls the write back when its audit insert fails", async () => {
    const { userId, ctx } = await userWithToken();
    const marker = `rollback-${randomUUID().slice(0, 8)}`;
    const error = await db
      .transaction(async (tx) => {
        await tx.insert(mcpTokens).values({
          userId,
          name: marker,
          lookupId: randomUUID().replaceAll("-", "").slice(0, 12),
          secretHash: "h",
          scopes: ["read"],
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        // A token id that doesn't exist violates the FK → the audit insert fails.
        await recordWriteAudit(
          tx,
          { ...ctx, tokenId: randomUUID() },
          {
            tool: "rename_saved_place",
            argsSummary: {},
            fields: ["name"],
            before: { name: "a", lat: 37.5 },
            after: { name: "b", lat: 37.5 },
          }
        );
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(McpAuditError);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM mcp_tokens WHERE name = $1", [
      marker,
    ]);
    expect(rows[0].n).toBe(0);
  });

  it("stores only allowlisted before/after fields for a committed write", async () => {
    const { userId, ctx } = await userWithToken();
    await db.transaction(async (tx) => {
      await recordWriteAudit(tx, ctx, {
        tool: "rename_saved_place",
        argsSummary: { placeId: "3f2b8c1e-1d2a-4b3c-9d8e-112233445566" },
        fields: ["name"],
        before: { name: "회사", lat: 37.5, rawText: "secret" },
        after: { name: "사무실", lat: 37.5, rawText: "secret" },
      });
    });
    const [row] = await db.select().from(mcpAuditLog).where(eq(mcpAuditLog.userId, userId));
    expect(row.writeBefore).toEqual({ name: "회사" });
    expect(row.writeAfter).toEqual({ name: "사무실" });
  });

  it("records a failed write as one error row with its code and no write payload", async () => {
    const { userId, tokenId, ctx } = await userWithToken();
    const written = await recordWriteFailure(db, ctx, {
      tool: "rename_saved_place",
      argsSummary: { placeId: "3f2b8c1e-1d2a-4b3c-9d8e-112233445566" },
      errorCode: "conflict",
    });
    expect(written).toBe(true);
    const rows = await db.select().from(mcpAuditLog).where(eq(mcpAuditLog.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tokenId,
      tool: "rename_saved_place",
      outcome: "error",
      errorCode: "conflict",
      denyReason: null,
      writeBefore: null,
      writeAfter: null,
    });
  });

  it("prunes idempotency keys older than 24 hours", async () => {
    const { userId, tokenId } = await userWithToken();
    const now = new Date("2026-11-13T03:00:00.000Z");
    await db.insert(mcpIdempotency).values([
      {
        userId,
        tokenId,
        key: "old",
        tool: "t",
        argsHash: "h",
        result: {},
        createdAt: new Date(now.getTime() - 25 * 3_600_000),
      },
      {
        userId,
        tokenId,
        key: "new",
        tool: "t",
        argsHash: "h",
        result: {},
        createdAt: new Date(now.getTime() - 3_600_000),
      },
    ]);
    expect(await pruneExpiredIdempotencyKeys(db, now)).toBeGreaterThanOrEqual(1);
    const left = await db.select().from(mcpIdempotency).where(eq(mcpIdempotency.userId, userId));
    expect(left.map((row) => row.key)).toEqual(["new"]);
  });
});
