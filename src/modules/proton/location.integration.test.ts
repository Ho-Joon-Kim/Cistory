process.env.TZ = "Asia/Seoul";

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { locationPoints, locationProcessingDays, photos } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import { useTransactionalDb } from "@/db/testing/transactional-db";
import { fillPhotoLocations } from "./location";

const NOW = new Date("2026-03-02T06:00:00Z");

describe("fillPhotoLocations", () => {
  const ctx = useTransactionalDb();

  async function addPhoto(
    userId: string,
    nodeUid: string,
    capturedAt: string,
    over: Partial<typeof photos.$inferInsert> = {}
  ) {
    await ctx
      .db()
      .insert(photos)
      .values({
        userId,
        nodeUid,
        capturedAt: new Date(capturedAt),
        detailsSyncedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
        ...over,
      });
  }
  async function addPoint(
    userId: string,
    ts: string,
    over: Partial<typeof locationPoints.$inferInsert> = {}
  ) {
    await ctx
      .db()
      .insert(locationPoints)
      .values({
        userId,
        lat: 37.5,
        lon: 127.0,
        timestamp: new Date(ts),
        createdAt: NOW,
        ...over,
      });
  }
  async function addDay(userId: string, date: string, pointCount: number) {
    await ctx.db().insert(locationProcessingDays).values({
      userId,
      date,
      status: "completed",
      pointCount,
    });
  }
  const get = async (userId: string, nodeUid: string) =>
    (await ctx.db().select().from(photos).where(eq(photos.nodeUid, nodeUid))).filter(
      (r) => r.userId === userId
    )[0];

  it("matches on UTC wall time: photo 03:00Z with point 03:05Z (gap 300), not a point at 12:05Z", async () => {
    const u = await insertTestUser(ctx.db());
    await addPhoto(u, "p", "2026-03-01T03:00:00Z");
    await addPoint(u, "2026-03-01T03:05:00Z", { lat: 1, lon: 2 });
    await addPoint(u, "2026-03-01T12:05:00Z", { lat: 9, lon: 9 });
    await fillPhotoLocations(ctx.db(), u, NOW);
    expect(await get(u, "p")).toMatchObject({
      lat: 1,
      lon: 2,
      locationSource: "owntracks",
      locationGapSec: 300,
    });
  });

  it("picks the nearer of two points in the window", async () => {
    const u = await insertTestUser(ctx.db());
    await addPhoto(u, "p", "2026-03-01T03:00:00Z");
    await addPoint(u, "2026-03-01T02:50:00Z", { lat: 1, lon: 1 });
    await addPoint(u, "2026-03-01T03:02:00Z", { lat: 2, lon: 2 });
    await fillPhotoLocations(ctx.db(), u, NOW);
    expect(await get(u, "p")).toMatchObject({ lat: 2, locationGapSec: 120 });
  });

  it("never uses another user's closer point", async () => {
    const u = await insertTestUser(ctx.db());
    const other = await insertTestUser(ctx.db());
    await addPhoto(u, "p", "2026-03-01T03:00:00Z");
    await addPoint(other, "2026-03-01T03:00:00Z", { lat: 5, lon: 5 });
    await addPoint(u, "2026-03-01T03:10:00Z", { lat: 1, lon: 1 });
    await fillPhotoLocations(ctx.db(), u, NOW);
    expect(await get(u, "p")).toMatchObject({ lat: 1, locationGapSec: 600 });
  });

  it("never uses anomaly points, and clears an owntracks fill once the only point turns anomalous", async () => {
    const u = await insertTestUser(ctx.db());
    await addPhoto(u, "p", "2026-03-01T03:00:00Z");
    await addPoint(u, "2026-03-01T03:01:00Z");
    await fillPhotoLocations(ctx.db(), u, NOW);
    expect((await get(u, "p"))?.locationSource).toBe("owntracks");
    expect((await get(u, "p"))?.locationCheckedAt).toBeNull();

    await ctx
      .db()
      .update(locationPoints)
      .set({ anomaly: true })
      .where(eq(locationPoints.userId, u));
    await fillPhotoLocations(ctx.db(), u, NOW);
    expect(await get(u, "p")).toMatchObject({
      lat: null,
      lon: null,
      locationSource: null,
      locationGapSec: null,
    });
  });

  it("settles via (a): completed lpd with matching point_count sets location_checked_at", async () => {
    const u = await insertTestUser(ctx.db());
    await addPhoto(u, "p", "2026-03-01T03:00:00Z");
    await addPoint(u, "2026-03-01T03:01:00Z");
    await addDay(u, "2026-03-01", 1);
    const r = await fillPhotoLocations(ctx.db(), u, NOW);
    expect(r).toEqual({ updated: 1, settled: 1 });
    expect((await get(u, "p"))?.locationCheckedAt).toEqual(NOW);
  });

  it("does not settle when point_count mismatches (late points) and recomputes next call", async () => {
    const u = await insertTestUser(ctx.db());
    await addPhoto(u, "p", "2026-03-01T03:00:00Z");
    await addPoint(u, "2026-03-01T03:30:00Z", { lat: 3, lon: 3 }); // outside window
    await addDay(u, "2026-03-01", 1);
    await addPoint(u, "2026-03-01T04:00:00Z"); // late flush -> count 2 != 1
    expect(await fillPhotoLocations(ctx.db(), u, NOW)).toEqual({ updated: 0, settled: 0 });
    expect((await get(u, "p"))?.locationCheckedAt).toBeNull();

    await addPoint(u, "2026-03-01T03:04:00Z", { lat: 4, lon: 4 });
    await fillPhotoLocations(ctx.db(), u, NOW);
    expect(await get(u, "p")).toMatchObject({ lat: 4, locationCheckedAt: null });
  });

  it("settles via (b): a 2019 day with no lpd row", async () => {
    const u = await insertTestUser(ctx.db());
    await addPhoto(u, "old", "2019-05-05T03:00:00Z");
    const r = await fillPhotoLocations(ctx.db(), u, NOW);
    expect(r).toEqual({ updated: 0, settled: 1 });
    const row = await get(u, "old");
    expect(row?.locationCheckedAt).toEqual(NOW);
    expect(row?.locationSource).toBeNull();
  });

  it("buckets a photo at 2026-03-01T16:30Z under the KST day 2026-03-02 lpd row", async () => {
    const u = await insertTestUser(ctx.db());
    await addPhoto(u, "late", "2026-03-01T16:30:00Z"); // 01:30 KST on the 2nd
    await addPoint(u, "2026-03-01T16:31:00Z");
    await addDay(u, "2026-03-02", 1);
    // A UTC-day lookup would find only a mismatching row here.
    await addDay(u, "2026-03-01", 99);
    expect(await fillPhotoLocations(ctx.db(), u, NOW)).toEqual({ updated: 1, settled: 1 });
  });

  it("ignores rows without details and exif rows", async () => {
    const u = await insertTestUser(ctx.db());
    await addPhoto(u, "nodetails", "2026-03-01T03:00:00Z", { detailsSyncedAt: null });
    await addPhoto(u, "exif", "2026-03-01T03:00:00Z", {
      lat: 7,
      lon: 7,
      locationSource: "exif",
    });
    await addPoint(u, "2026-03-01T03:01:00Z");
    expect(await fillPhotoLocations(ctx.db(), u, NOW)).toEqual({ updated: 0, settled: 0 });
    expect(await get(u, "nodetails")).toMatchObject({ lat: null, locationCheckedAt: null });
    expect(await get(u, "exif")).toMatchObject({ lat: 7, locationSource: "exif" });
  });
});
