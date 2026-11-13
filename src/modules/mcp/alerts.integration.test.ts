import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { mcpAlertState } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import { logger } from "@/lib/logger";
import { createDbAlertStore, MCP_ALERT_DAILY_CAP, notifyMcpDenied } from "./alerts";
import type { McpDeniedEvent } from "./alerts-hook";
import { issueToken } from "./tokens";

// Committed rows on a pool: the race needs two real connections, so the
// transaction-per-test harness can't host it. Rows go with the users cascade.
describe("MCP owner alerts against PostgreSQL", () => {
  let pool: Pool;
  let db: Database;
  const createdUsers: string[] = [];
  const env = {
    MCP_ALERT_TELEGRAM_BOT_TOKEN: "1:test",
    MCP_ALERT_TELEGRAM_CHAT_ID: "1",
  } as NodeJS.ProcessEnv;

  beforeAll(() => {
    if (!process.env.TEST_DATABASE_URL) throw new Error("Use disposable TEST_DATABASE_URL only");
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 8 });
    db = drizzle(pool, { schema }) as unknown as Database;
    vi.spyOn(logger, "warn").mockImplementation(() => {});
  });
  afterEach(async () => {
    if (createdUsers.length > 0) {
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [createdUsers.splice(0)]);
    }
  });
  afterAll(async () => {
    await pool?.end();
  });

  async function denial(overrides: Partial<McpDeniedEvent> = {}): Promise<McpDeniedEvent> {
    const userId = await insertTestUser(db as never);
    createdUsers.push(userId);
    const { token } = await issueToken(db, userId, { name: "agent", scopes: ["read"] });
    return {
      userId,
      tokenId: token.id,
      tokenName: "agent",
      reason: "ip_not_allowed",
      ip: "198.51.100.7",
      country: "US",
      ...overrides,
    };
  }

  it("lets exactly one of two concurrent claims for the same window send", async () => {
    const event = await denial();
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const now = new Date();
    const deps = { store: createDbAlertStore(db), fetch: fetchMock, env, now: () => now };

    const results = await Promise.all([
      notifyMcpDenied(event, deps),
      notifyMcpDenied(event, deps),
      notifyMcpDenied(event, deps),
    ]);

    expect(results.filter((r) => r === "alert")).toHaveLength(1);
    expect(results.filter((r) => r === "debounced")).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const rows = await db
      .select()
      .from(mcpAlertState)
      .where(eq(mcpAlertState.userId, event.userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].hitCount).toBe(3);
    expect(rows[0].tokenKey).toBe(event.tokenId);
    expect(rows[0].sentAt?.getTime()).toBe(now.getTime());
  });

  it("enforces the daily cap and the cap notice under concurrency", async () => {
    const event = await denial();
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const now = new Date();
    const deps = { store: createDbAlertStore(db), fetch: fetchMock, env, now: () => now };

    const results = await Promise.all(
      Array.from({ length: MCP_ALERT_DAILY_CAP + 5 }, (_, i) =>
        notifyMcpDenied({ ...event, ip: `203.0.113.${i}` }, deps)
      )
    );
    expect(results.filter((r) => r === "alert")).toHaveLength(MCP_ALERT_DAILY_CAP);
    expect(results.filter((r) => r === "cap_notice")).toHaveLength(1);
    expect(results.filter((r) => r === "suppressed")).toHaveLength(4);
    expect(fetchMock).toHaveBeenCalledTimes(MCP_ALERT_DAILY_CAP + 1);

    // The first event of a new (token, reason) still gets through over the cap.
    expect(await notifyMcpDenied({ ...event, reason: "scope_denied" }, deps)).toBe("alert");
  });

  it("keys a token-less denial on the empty token key", async () => {
    const event = await denial({ tokenId: null, ip: null });
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const now = new Date();
    const deps = { store: createDbAlertStore(db), fetch: fetchMock, env, now: () => now };
    expect(await notifyMcpDenied(event, deps)).toBe("alert");
    expect(await notifyMcpDenied(event, deps)).toBe("debounced");
    const [row] = await db
      .select()
      .from(mcpAlertState)
      .where(eq(mcpAlertState.userId, event.userId));
    expect(row).toMatchObject({ tokenKey: "", ip: "", tokenId: null, hitCount: 2 });
  });
});
