import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { photoBlocks, photos, photoThumbnails, protonConnections, users } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import { useTransactionalDb } from "@/db/testing/transactional-db";

describe("Proton photo data cascade on user deletion", () => {
  const ctx = useTransactionalDb();

  it("deleting the users row cascades proton_connections, photos, photo_thumbnails and photo_blocks", async () => {
    const db = ctx.db();
    const owner = await insertTestUser(db);
    const other = await insertTestUser(db);
    const now = new Date("2026-11-10T03:00:00Z");
    const stamps = { createdAt: now, updatedAt: now };
    let ownerPhotoId = "";
    for (const userId of [owner, other]) {
      await db.insert(protonConnections).values({ userId, status: "active", ...stamps });
      const [photo] = await db
        .insert(photos)
        .values({ userId, nodeUid: `n-${userId}`, capturedAt: now, ...stamps })
        .returning({ id: photos.id });
      if (userId === owner) ownerPhotoId = photo.id;
      await db
        .insert(photoThumbnails)
        .values({ photoId: photo.id, bytes: Buffer.from([1, 2, 3]), fetchedAt: now });
      await db
        .insert(photoBlocks)
        .values({ userId, nodeUid: `b-${userId}`, blockedAt: now, modelVersion: "m" });
    }

    const countFor = async (userId: string) => ({
      connections: (
        await db.select().from(protonConnections).where(eq(protonConnections.userId, userId))
      ).length,
      photos: (await db.select().from(photos).where(eq(photos.userId, userId))).length,
      blocks: (await db.select().from(photoBlocks).where(eq(photoBlocks.userId, userId))).length,
    });
    const thumbnails = async () =>
      (
        await db
          .select({ id: photoThumbnails.photoId })
          .from(photoThumbnails)
          .innerJoin(photos, eq(photos.id, photoThumbnails.photoId))
          .where(eq(photos.userId, owner))
      ).length;
    expect(await thumbnails()).toBe(1);

    await db.delete(users).where(eq(users.id, owner));

    expect(await countFor(owner)).toEqual({ connections: 0, photos: 0, blocks: 0 });
    expect(await countFor(other)).toEqual({ connections: 1, photos: 1, blocks: 1 });
    // Thumbnails are keyed by photo id; the owner's photo is gone, the other's remains.
    const remaining = await db
      .select({ id: photoThumbnails.photoId })
      .from(photoThumbnails)
      .innerJoin(photos, eq(photos.id, photoThumbnails.photoId))
      .where(eq(photos.userId, other));
    expect(remaining).toHaveLength(1);
    expect(
      await db.select().from(photoThumbnails).where(eq(photoThumbnails.photoId, ownerPhotoId))
    ).toHaveLength(0);
  });
});
