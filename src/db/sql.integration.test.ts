process.env.TZ = "Asia/Seoul";

import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { users } from "@/db";
import { localDaySql, timestampFromDriver, timestampParam } from "@/db/sql";
import { insertTestUser } from "@/db/testing/fixtures";
import { useTransactionalDb } from "@/db/testing/transactional-db";

/**
 * Pins src/db/sql.ts's three KST helpers against a REAL Postgres whose
 * session `TimeZone` is Asia/Seoul (docker-compose.test.yml — see its header
 * for why that setting is load-bearing, not cosmetic). Nothing here can be
 * expressed as a unit test: the property under test is what a live server
 * does with these values, not what the TypeScript does.
 *
 * Run via `yarn test:integration` — needs Docker. `yarn test` never touches
 * this file (vitest.config.mts excludes *.integration.test.ts).
 */
describe("src/db/sql.ts against a real Asia/Seoul-session Postgres", () => {
  const ctx = useTransactionalDb();

  it("a value written via the Drizzle query builder round-trips through a raw read + timestampFromDriver", async () => {
    const db = ctx.db();
    const original = new Date("2026-08-08T03:24:05.123Z");
    const userId = await insertTestUser(db, { lastSyncedAt: original });

    // A raw `db.execute` read — same shape as every raw SELECT in the repo —
    // bypasses Drizzle's own column mapping and hands back the driver's
    // string, exactly what timestampFromDriver exists to correct.
    const { rows } = await db.execute<{ last_synced_at: unknown }>(
      sql`SELECT last_synced_at FROM users WHERE id = ${userId}::uuid`
    );
    expect(typeof rows[0].last_synced_at).toBe("string");

    const roundTripped = timestampFromDriver(users.lastSyncedAt, rows[0].last_synced_at);
    expect(roundTripped.getTime()).toBe(original.getTime());
  });

  it("a value written via raw SQL + timestampParam round-trips through the Drizzle query builder", async () => {
    const db = ctx.db();
    const original = new Date("2026-08-08T03:24:05.123Z");
    const userId = await insertTestUser(db);

    await db.execute(sql`
      UPDATE users SET last_synced_at = ${timestampParam(users.lastSyncedAt, original)}
      WHERE id = ${userId}::uuid
    `);

    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row.lastSyncedAt).toBeInstanceOf(Date);
    expect(row.lastSyncedAt?.getTime()).toBe(original.getTime());
  });

  it("interpolating a bare Date instead of routing through timestampParam lands 9 hours off — the trap timestampParam exists to close", async () => {
    const db = ctx.db();
    const original = new Date("2026-08-08T03:24:05.000Z");
    const viaHelper = await insertTestUser(db);
    const viaBareDate = await insertTestUser(db);

    await db.execute(sql`
      UPDATE users SET last_synced_at = ${timestampParam(users.lastSyncedAt, original)}
      WHERE id = ${viaHelper}::uuid
    `);
    // The historical bug: a bare Date bypasses column mapping and reaches
    // node-postgres as a JS Date, which pg serializes using the *process*
    // timezone (Asia/Seoul, per this file's TZ line) rather than UTC.
    await db.execute(sql`
      UPDATE users SET last_synced_at = ${original}
      WHERE id = ${viaBareDate}::uuid
    `);

    const rows = await db
      .select({ id: users.id, lastSyncedAt: users.lastSyncedAt })
      .from(users)
      .where(sql`${users.id} IN (${viaHelper}::uuid, ${viaBareDate}::uuid)`);
    const correct = rows.find((r) => r.id === viaHelper)?.lastSyncedAt;
    const buggy = rows.find((r) => r.id === viaBareDate)?.lastSyncedAt;
    expect(correct?.getTime()).toBe(original.getTime());

    const diffHours = ((buggy?.getTime() ?? 0) - (correct?.getTime() ?? 0)) / (60 * 60 * 1000);
    expect(diffHours).toBeCloseTo(9, 5);
  });

  it("localDaySql buckets a 00:00-09:00 KST instant onto the KST day, not the UTC day DATE(col) would give", async () => {
    const db = ctx.db();
    // 2026-08-08 02:15 KST == 2026-08-07 17:15 UTC. Drizzle writes UTC wall
    // time, so the stored naive value is "2026-08-07 17:15:00" — DATE(col)
    // reads that as Aug 7. localDaySql must read Aug 8.
    const instant = new Date("2026-08-07T17:15:00.000Z");
    const userId = await insertTestUser(db, { lastSyncedAt: instant });

    const wrong = await db.execute<{ wrong_day: string }>(
      sql`SELECT DATE(last_synced_at)::text AS wrong_day FROM users WHERE id = ${userId}::uuid`
    );
    const right = await db.execute<{ kst_day: string }>(
      sql`SELECT ${localDaySql(users.lastSyncedAt)}::text AS kst_day FROM users WHERE id = ${userId}::uuid`
    );

    expect(wrong.rows[0].wrong_day).toBe("2026-08-07");
    expect(right.rows[0].kst_day).toBe("2026-08-08");
  });

  it("a bare now() genuinely differs from now() AT TIME ZONE 'UTC' by exactly 9 hours on this server — the trap itself", async () => {
    const db = ctx.db();
    // now() is stable within a statement/transaction, so both references
    // below are the same instant — the only variable is how each expression
    // interprets it. Re-interpreting the UTC-wall text as if it were a KST
    // wall clock (`::timestamptz`, under the session's Asia/Seoul TimeZone)
    // is exactly the bug this whole file exists to catch: a value nine
    // hours away from the real instant, with nothing in the type system to
    // flag it.
    const { rows } = await db.execute<{ diff_seconds: string }>(sql`
      SELECT extract(epoch FROM (now() - (now() AT TIME ZONE 'UTC')::timestamptz)) AS diff_seconds
    `);
    expect(Number(rows[0].diff_seconds)).toBeCloseTo(9 * 3600, 0);
  });
});
