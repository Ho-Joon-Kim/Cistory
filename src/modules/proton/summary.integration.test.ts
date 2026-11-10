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
    });
    expect(await getProtonSummary(db, "00000000-0000-0000-0000-000000000000")).toMatchObject({
      connected: false,
      status: null,
      photoCount: 0,
      backfilling: false,
    });
  });
});
