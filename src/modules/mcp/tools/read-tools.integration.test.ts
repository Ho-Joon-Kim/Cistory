import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Database } from "@/db";
import { locationPoints, periodSnapshots, photos, photoThumbnails } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import { useTransactionalDb } from "@/db/testing/transactional-db";
import { currentLocationTool, gpsPointsTool } from "./location";
import { overviewTool } from "./overview-search";
import { photosTool, photoThumbnailsTool } from "./photos";
import { callTool, toolContext } from "./test-context";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

describe("MCP read tools against PostgreSQL", () => {
  const t = useTransactionalDb();
  const db = () => t.db() as unknown as Database;

  async function ctxFor(scopes: Parameters<typeof toolContext>[0] = ["read"]) {
    const userId = await insertTestUser(t.db());
    return toolContext(scopes, { db: db(), userId, now: new Date("2026-11-13T09:00:00Z") });
  }

  it("current_location with no points says 기록 없음 and returns no coordinates", async () => {
    const ctx = await ctxFor();
    const out = await callTool(currentLocationTool, {}, ctx);
    expect(out.structured).toMatchObject({
      status: "no_data",
      latestPoint: null,
      nearSavedPlace: null,
      lastVisit: null,
      visitDataThrough: null,
      lastProcessedSubwayRide: null,
    });
  });

  it("gps_points pages without duplicates or gaps, even across equal timestamps", async () => {
    const ctx = await ctxFor();
    const other = await insertTestUser(t.db());
    const base = Date.parse("2026-11-13T00:00:00Z");
    const rows = Array.from({ length: 7 }, (_, i) => ({
      userId: ctx.userId,
      lat: 37 + i / 1000,
      lon: 127,
      // Two points share each timestamp, so only the (timestamp, id) key is stable.
      timestamp: new Date(base + Math.floor(i / 2) * 60_000),
      createdAt: new Date(),
    }));
    await t.db().insert(locationPoints).values(rows);
    await t
      .db()
      .insert(locationPoints)
      .values([
        { ...rows[0], userId: other, lat: 1 },
        { ...rows[1], userId: ctx.userId, lat: 2, anomaly: true },
      ]);

    const seen: number[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const out = await callTool(gpsPointsTool, { from: "2026-11-13", limit: 3, cursor }, ctx);
      seen.push(...(out.structured.points as { lat: number }[]).map((p) => p.lat));
      cursor = (out.structured.nextCursor as string | null) ?? undefined;
      if (!cursor) break;
    }
    expect(seen.sort()).toEqual(rows.map((r) => r.lat).sort());
  });

  it("photos and photo_thumbnails expose only screened, live, own photos", async () => {
    const ctx = await ctxFor();
    const other = await insertTestUser(t.db());
    const capturedAt = new Date("2026-11-12T03:00:00Z");
    const now = new Date();
    const make = (userId: string, extra: Partial<typeof photos.$inferInsert> = {}) => ({
      id: randomUUID(),
      userId,
      nodeUid: randomUUID(),
      capturedAt,
      detailsSyncedAt: now,
      ...extra,
    });
    const exposed = make(ctx.userId);
    const unscreened = make(ctx.userId, { detailsSyncedAt: null });
    const deleted = make(ctx.userId, { deletedAt: now });
    const trashed = make(ctx.userId, { trashedAt: now });
    const foreign = make(other);
    const all = [exposed, unscreened, deleted, trashed, foreign];
    await t.db().insert(photos).values(all);
    await t
      .db()
      .insert(photoThumbnails)
      .values(all.map((p) => ({ photoId: p.id, bytes: JPEG, fetchedAt: now })));

    const list = await callTool(photosTool, { from: "2026-11-12", to: "2026-11-12" }, ctx);
    expect((list.structured.photos as { id: string }[]).map((p) => p.id)).toEqual([exposed.id]);
    expect((list.structured.photos as { hasThumbnail: boolean }[])[0].hasThumbnail).toBe(true);

    const thumbs = await callTool(
      photoThumbnailsTool,
      { photoIds: [unscreened.id, exposed.id, foreign.id, deleted.id, trashed.id] },
      ctx
    );
    expect(thumbs.content).toHaveLength(1);
    expect(thumbs.structured.items).toEqual([
      { photoId: unscreened.id, status: "not_found" },
      { photoId: exposed.id, status: "ok", mimeType: "image/jpeg", imageIndex: 0 },
      { photoId: foreign.id, status: "not_found" },
    ]);
    expect(thumbs.structured.deferredPhotoIds).toEqual([deleted.id, trashed.id]);
  });

  it("overview serves a pending snapshot as stale and enqueues nothing", async () => {
    const ctx = await ctxFor();
    const computedAt = "2026-11-10T00:00:00.000Z";
    const envelope = {
      data: { totalCommits: 3 },
      status: "ready" as const,
      computedAt,
      computeVersion: 4,
      errorCode: null,
    };
    const updatedAt = new Date("2026-11-13T00:00:00Z");
    await t.db().insert(periodSnapshots).values({
      userId: ctx.userId,
      periodType: "month",
      periodKey: "2026-11",
      status: "pending",
      attemptCount: 0,
      coding: envelope,
      createdAt: updatedAt,
      updatedAt,
    });

    const out = await callTool(overviewTool, { periodType: "month", periodKey: "2026-11" }, ctx);
    expect(out.structured).toMatchObject({
      status: "pending",
      stale: true,
      computedAt: "2026-11-10T09:00:00+09:00",
    });

    // A missing period stays missing (no row is created), and the pending row is untouched.
    const missing = await callTool(
      overviewTool,
      { periodType: "month", periodKey: "2026-10" },
      ctx
    );
    expect(missing.structured.status).toBe("missing");
    const rows = await t
      .db()
      .select()
      .from(periodSnapshots)
      .where(eq(periodSnapshots.userId, ctx.userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "pending", attemptCount: 0 });
    expect(rows[0].updatedAt.getTime()).toBe(updatedAt.getTime());
    const narratives = await t
      .client()
      .query("SELECT count(*)::int AS n FROM period_narratives WHERE user_id = $1", [ctx.userId]);
    expect(narratives.rows[0].n).toBe(0);
  });
});
