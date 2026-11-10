import { describe, expect, it } from "vitest";
import { photoBlocks, photos, protonConnections } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import { useTransactionalDb } from "@/db/testing/transactional-db";
import { getProtonSummary } from "./summary";

describe("getProtonSummary", () => {
  const ctx = useTransactionalDb();

  it("counts only exposed photos, separates exhausted details, and is owner-scoped", async () => {
    const db = ctx.db();
    const owner = await insertTestUser(db);
    const other = await insertTestUser(db);
    const now = new Date("2026-11-10T03:00:00Z");
    await db.insert(protonConnections).values({
      userId: owner,
      status: "active",
      volumeId: "vol",
      lastSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const photo = (userId: string, nodeUid: string, over: Partial<typeof photos.$inferInsert>) => ({
      userId,
      nodeUid,
      capturedAt: now,
      createdAt: now,
      updatedAt: now,
      ...over,
    });
    await db
      .insert(photos)
      .values([
        photo(owner, "exposed", { detailsSyncedAt: now }),
        photo(owner, "deleted", { detailsSyncedAt: now, deletedAt: now }),
        photo(owner, "listed-only", {}),
        photo(owner, "exhausted", { detailsAttempts: 3 }),
        photo(owner, "exhausted-deleted", { detailsAttempts: 3, deletedAt: now }),
        photo(other, "foreign", { detailsSyncedAt: now }),
      ]);
    await db.insert(photoBlocks).values([
      { userId: owner, nodeUid: "b1", blockedAt: now, modelVersion: "m" },
      { userId: other, nodeUid: "b2", blockedAt: now, modelVersion: "m" },
    ]);

    expect(await getProtonSummary(db, owner)).toEqual({
      connected: true,
      status: "active",
      photoCount: 1,
      lastSyncedAt: now.toISOString(),
      backfilling: true,
      detailsFailedCount: 1,
      blockedCount: 1,
      lastError: null,
      forkPending: false,
    });
    expect(await getProtonSummary(db, "00000000-0000-0000-0000-000000000000")).toMatchObject({
      connected: false,
      status: null,
      photoCount: 0,
      backfilling: false,
      forkPending: false,
    });
  });

  it("reports an open reconnect fork on an active or needs_reauth row until it expires", async () => {
    const db = ctx.db();
    const now = new Date("2026-11-10T03:00:00Z");
    const later = new Date(now.getTime() + 10 * 60_000);
    const reauth = await insertTestUser(db);
    const active = await insertTestUser(db);
    const idle = await insertTestUser(db);
    const base = { volumeId: "vol", createdAt: now, updatedAt: now };
    await db.insert(protonConnections).values([
      {
        ...base,
        userId: reauth,
        status: "needs_reauth",
        pendingForkSelector: "sel-r",
        pendingForkKeyEnc: "k",
        pendingForkExpiresAt: later,
      },
      {
        ...base,
        userId: active,
        status: "active",
        pendingForkSelector: "sel-a",
        pendingForkKeyEnc: "k",
        pendingForkExpiresAt: later,
      },
      { ...base, userId: idle, status: "active" },
    ]);

    expect(await getProtonSummary(db, reauth, now)).toMatchObject({
      status: "needs_reauth",
      forkPending: true,
    });
    expect(await getProtonSummary(db, active, now)).toMatchObject({
      status: "active",
      forkPending: true,
    });
    expect(await getProtonSummary(db, idle, now)).toMatchObject({ forkPending: false });
    // An elapsed fork no longer counts, even before the poll clears it.
    expect(await getProtonSummary(db, active, later)).toMatchObject({ forkPending: false });
  });
});
