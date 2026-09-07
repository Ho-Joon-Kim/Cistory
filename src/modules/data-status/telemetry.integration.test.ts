import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { sourceSyncStates } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import { useTransactionalDb } from "@/db/testing/transactional-db";
import { recordSourceSuccess } from "./telemetry";

describe("push success timestamp ordering", () => {
  const ctx = useTransactionalDb();
  it("preserves a newer concurrent failure and never moves receipt timestamps backwards", async () => {
    const db = ctx.db();
    const userId = await insertTestUser(db);
    const first = new Date("2026-09-07T01:00:00Z");
    const second = new Date("2026-09-07T02:00:00Z");
    const third = new Date("2026-09-07T03:00:00Z");
    await recordSourceSuccess(db, userId, "location", first);
    await db
      .update(sourceSyncStates)
      .set({ lastAttemptAt: third, error: "newer failure" })
      .where(eq(sourceSyncStates.userId, userId));
    await recordSourceSuccess(db, userId, "location", second);
    const [state] = await db
      .select()
      .from(sourceSyncStates)
      .where(eq(sourceSyncStates.userId, userId));
    expect(state).toMatchObject({
      lastAttemptAt: third,
      lastSuccessAt: second,
      error: "newer failure",
    });
    await recordSourceSuccess(db, userId, "location", first);
    expect(
      await db.select().from(sourceSyncStates).where(eq(sourceSyncStates.userId, userId))
    ).toEqual([state]);
    await recordSourceSuccess(db, userId, "location", new Date("2026-09-07T04:00:00Z"));
    const [cleared] = await db
      .select()
      .from(sourceSyncStates)
      .where(eq(sourceSyncStates.userId, userId));
    expect(cleared.error).toBeNull();
    expect(cleared.lastSuccessAt).toEqual(new Date("2026-09-07T04:00:00Z"));
  });
});
