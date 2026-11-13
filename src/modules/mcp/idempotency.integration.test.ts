import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { mcpIdempotency } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import {
  IDEMPOTENCY_TTL_MS,
  IdempotencyRaceError,
  lookupIdempotency,
  storeIdempotency,
} from "./idempotency";
import { issueToken } from "./tokens";

// Pins the ON CONFLICT ... DO UPDATE ... WHERE created_at < cutoff path: an
// expired key (not yet pruned) is overwritten in place, a live one is a race.
// Committed rows on a pool, removed through the users cascade.
describe("MCP idempotency keys against PostgreSQL", () => {
  let pool: Pool;
  let db: Database;
  const created: string[] = [];

  beforeAll(() => {
    if (!process.env.TEST_DATABASE_URL) throw new Error("Use disposable TEST_DATABASE_URL only");
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
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

  async function seed(ageMs: number) {
    const userId = await insertTestUser(db as never);
    created.push(userId);
    const { token } = await issueToken(db, userId, { name: "agent", scopes: ["write"] });
    const now = new Date();
    const base = { userId, tokenId: token.id, key: "k-1" };
    await db.insert(mcpIdempotency).values({
      ...base,
      tool: "trip_create",
      argsHash: "old-hash",
      result: { trip: { id: "old" } },
      createdAt: new Date(now.getTime() - ageMs),
    });
    return { base, now };
  }

  async function rows(tokenId: string) {
    return db
      .select()
      .from(mcpIdempotency)
      .where(and(eq(mcpIdempotency.tokenId, tokenId), eq(mcpIdempotency.key, "k-1")));
  }

  it("overwrites a 25h-old key in place without throwing", async () => {
    const { base, now } = await seed(25 * 60 * 60 * 1000);

    await expect(
      storeIdempotency(
        db,
        {
          ...base,
          tool: "saved_place_create",
          argsHash: "new-hash",
          result: { place: { id: "new" } },
        },
        now
      )
    ).resolves.toBeUndefined();

    const stored = await rows(base.tokenId);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      tool: "saved_place_create",
      argsHash: "new-hash",
      result: { place: { id: "new" } },
    });
    // Same instant back (UTC wall time round-trip), now a live key.
    expect(stored[0].createdAt.getTime()).toBe(now.getTime());
    expect(
      await lookupIdempotency(
        db,
        { tokenId: base.tokenId, key: "k-1", tool: "saved_place_create", argsHash: "new-hash" },
        now
      )
    ).toEqual({ result: { place: { id: "new" } } });
  });

  it("a live (<24h) key held by another winner raises IdempotencyRaceError and keeps the row", async () => {
    const { base, now } = await seed(IDEMPOTENCY_TTL_MS - 60 * 60 * 1000);

    await expect(
      storeIdempotency(
        db,
        { ...base, tool: "trip_create", argsHash: "other-hash", result: { trip: { id: "loser" } } },
        now
      )
    ).rejects.toBeInstanceOf(IdempotencyRaceError);

    const stored = await rows(base.tokenId);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ argsHash: "old-hash", result: { trip: { id: "old" } } });
  });
});
