import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { photoBlocks, photos, protonConnections } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import type { TestDb } from "@/db/testing/transactional-db";
import type { ProtonPhotosApi } from "@/lib/adapters/proton/client";
import { encryptSecret } from "@/lib/crypto";
import {
  completeBackfill,
  nextBackfillStep,
  runDetailsStage,
  runTimelineListing,
} from "./backfill";
import { ProtonConnectionService } from "./connection";
import type { PhotoClassifier } from "./nsfw/classifier";
import {
  assertConnectionUnchanged,
  countPendingDetails,
  ProtonConnectionChangedError,
  type ProtonTickFence,
} from "./repository";
import { PROTON_MAX_DETAILS_ATTEMPTS } from "./types";

/**
 * Real-Postgres properties of the backfill: the listing reconcile (bound
 * text[] membership, related-photo exception, blocked skip, reappearance) and
 * the details selection's attempt cap. The stages open their own
 * transactions, which the rollback-per-test helper cannot nest, so rows are
 * committed under fresh fixture users and removed afterwards (everything
 * cascades from `users`).
 */
describe("proton backfill against PostgreSQL", () => {
  const NOW = new Date("2026-11-10T03:00:00.000Z");
  const EARLIER = new Date("2026-11-01T03:00:00.000Z");
  const CAPTURED = new Date("2026-03-04T15:30:00.000Z");
  const FENCE: ProtonTickFence = { volumeId: "vol-1", uid: "U1" };

  let pool: Pool;
  let db: Database;
  const created: string[] = [];

  beforeAll(() => {
    if (!process.env.TEST_DATABASE_URL) throw new Error("Use disposable TEST_DATABASE_URL only");
    vi.stubEnv("KIS_ENCRYPTION_KEY", process.env.KIS_ENCRYPTION_KEY ?? "k".repeat(32));
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    db = drizzle(pool, { schema }) as unknown as Database;
  });

  afterEach(async () => {
    if (created.length) {
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [created.splice(0)]);
    }
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await pool?.end();
  });

  async function newConnectedUser(over: Partial<typeof protonConnections.$inferInsert> = {}) {
    const userId = await insertTestUser(db as unknown as TestDb);
    created.push(userId);
    await db.insert(protonConnections).values({
      userId,
      status: "active",
      uidEnc: encryptSecret(FENCE.uid),
      volumeId: FENCE.volumeId,
      eventCursor: "ev-1",
      createdAt: EARLIER,
      updatedAt: EARLIER,
      ...over,
    });
    return userId;
  }

  async function seed(userId: string, nodeUid: string, over = {}) {
    await db.insert(photos).values({
      userId,
      nodeUid,
      capturedAt: CAPTURED,
      createdAt: EARLIER,
      updatedAt: EARLIER,
      ...over,
    });
  }

  async function rowOf(userId: string, nodeUid: string) {
    const [row] = await db
      .select()
      .from(photos)
      .where(and(eq(photos.userId, userId), eq(photos.nodeUid, nodeUid)));
    return row;
  }

  async function connectionOf(userId: string) {
    const [row] = await db
      .select()
      .from(protonConnections)
      .where(eq(protonConnections.userId, userId));
    return row;
  }

  function timelineApi(uids: string[]) {
    const iterateTimeline = vi.fn(async function* () {
      for (const nodeUid of uids) yield { nodeUid, captureTime: CAPTURED, tags: [0] };
    });
    return { api: { iterateTimeline } as unknown as ProtonPhotosApi, iterateTimeline };
  }

  it("listing soft-deletes unlisted rows but not related rows (main_photo_node_uid set)", async () => {
    const user = await newConnectedUser();
    await seed(user, "kept", { detailsSyncedAt: EARLIER });
    await seed(user, "gone", { detailsSyncedAt: EARLIER });
    await seed(user, "live-part", { mainPhotoNodeUid: "kept", detailsSyncedAt: EARLIER });

    const { api } = timelineApi(["kept"]);
    await expect(runTimelineListing(db, api, user, FENCE, NOW)).resolves.toBe(1);

    expect((await rowOf(user, "kept")).deletedAt).toBeNull();
    expect((await rowOf(user, "gone")).deletedAt).toEqual(NOW);
    expect((await rowOf(user, "live-part")).deletedAt).toBeNull();
    expect((await connectionOf(user)).timelineListedAt).toEqual(NOW);
  });

  it("listing marks related rows deleted when their main is deleted", async () => {
    const user = await newConnectedUser();
    await seed(user, "main", { detailsSyncedAt: EARLIER });
    await seed(user, "other", { detailsSyncedAt: EARLIER });
    await seed(user, "main-part", { mainPhotoNodeUid: "main", detailsSyncedAt: EARLIER });

    const { api } = timelineApi(["other"]);
    await runTimelineListing(db, api, user, FENCE, NOW);

    expect((await rowOf(user, "main")).deletedAt).toEqual(NOW);
    expect((await rowOf(user, "main-part")).deletedAt).toEqual(NOW);
    expect((await rowOf(user, "other")).deletedAt).toBeNull();
  });

  it("listing skips blocked node_uids and clears deleted_at on rows that reappear", async () => {
    const user = await newConnectedUser();
    await seed(user, "back", { deletedAt: EARLIER, detailsSyncedAt: EARLIER });
    await db
      .insert(photoBlocks)
      .values({ userId: user, nodeUid: "nsfw", blockedAt: EARLIER, modelVersion: "m" });

    const { api } = timelineApi(["back", "nsfw", "new"]);
    await runTimelineListing(db, api, user, FENCE, NOW);

    expect(await rowOf(user, "back")).toMatchObject({
      deletedAt: null,
      detailsSyncedAt: EARLIER,
      updatedAt: NOW,
    });
    expect(await rowOf(user, "nsfw")).toBeUndefined();
    expect(await rowOf(user, "new")).toMatchObject({
      capturedAt: CAPTURED,
      detailsSyncedAt: null,
      deletedAt: null,
      createdAt: NOW,
    });
  });

  it("binds the listing as one text[] even for a single uid with array-literal characters", async () => {
    const user = await newConnectedUser();
    const odd = 'v~a,b"{c}\\d';
    await seed(user, odd);
    await seed(user, "plain");

    const { api } = timelineApi([odd]);
    await runTimelineListing(db, api, user, FENCE, NOW);

    expect((await rowOf(user, odd)).deletedAt).toBeNull();
    expect((await rowOf(user, "plain")).deletedAt).toEqual(NOW);
  });

  it("lists the timeline only when timeline_listed_at is null (never re-lists after)", async () => {
    const user = await newConnectedUser();
    const first = timelineApi(["a"]);
    await runTimelineListing(db, first.api, user, FENCE, NOW);

    const second = timelineApi([]);
    await expect(runTimelineListing(db, second.api, user, FENCE, NOW)).resolves.toBe(0);
    expect(second.iterateTimeline).not.toHaveBeenCalled();
    expect((await rowOf(user, "a")).deletedAt).toBeNull();
  });

  it("an empty listing with no live rows marks the timeline listed (C12 refinement)", async () => {
    const user = await newConnectedUser();
    await seed(user, "old", { deletedAt: EARLIER });

    await runTimelineListing(db, timelineApi([]).api, user, FENCE, NOW);

    expect((await connectionOf(user)).timelineListedAt).toEqual(NOW);
    expect(nextBackfillStep(await connectionOf(user), 0)).toBe("complete");
  });

  it("a disconnect racing a fenced sync transaction leaves no orphan rows", async () => {
    // Sync first: the disconnect must wait for the sync to commit, then delete it all.
    const user = await newConnectedUser();
    const service = new ProtonConnectionService(db, { revoke: vi.fn(async () => true) });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fenced!: () => void;
    const fencedYet = new Promise<void>((resolve) => {
      fenced = resolve;
    });
    const sync = db.transaction(async (tx) => {
      await assertConnectionUnchanged(tx, user, FENCE);
      await tx.insert(photos).values({
        userId: user,
        nodeUid: "synced",
        capturedAt: CAPTURED,
        detailsSyncedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      });
      await tx
        .insert(photoBlocks)
        .values({ userId: user, nodeUid: "blocked", blockedAt: NOW, modelVersion: "m" });
      fenced();
      await gate;
    });
    await fencedYet;
    let disconnected = false;
    const disconnect = service.disconnect(user).then((r) => {
      disconnected = true;
      return r;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(disconnected).toBe(false); // blocked on the proton-token lock
    release();
    await sync;
    await disconnect;

    const left = await pool.query(
      `SELECT (SELECT count(*) FROM photos WHERE user_id = $1)::int AS photos,
              (SELECT count(*) FROM photo_blocks WHERE user_id = $1)::int AS blocks,
              (SELECT count(*) FROM proton_connections WHERE user_id = $1)::int AS conns`,
      [user]
    );
    expect(left.rows[0]).toEqual({ photos: 0, blocks: 0, conns: 0 });

    // Disconnect first: the next fenced write aborts and writes nothing.
    await expect(runTimelineListing(db, timelineApi(["late"]).api, user, FENCE, NOW)).resolves.toBe(
      0
    );
    const user2 = await newConnectedUser();
    const listedBefore = (await connectionOf(user2)).timelineListedAt;
    expect(listedBefore).toBeNull();
    await service.disconnect(user2);
    await expect(
      db.transaction(async (tx) => {
        await assertConnectionUnchanged(tx, user2, FENCE);
        await tx.insert(photos).values({
          userId: user2,
          nodeUid: "late",
          capturedAt: CAPTURED,
          createdAt: NOW,
          updatedAt: NOW,
        });
      })
    ).rejects.toBeInstanceOf(ProtonConnectionChangedError);
    expect(await rowOf(user2, "late")).toBeUndefined();
  });

  it("an empty listing while live rows exist soft-deletes nothing and stays unlisted (C12)", async () => {
    const user = await newConnectedUser();
    await seed(user, "a", { detailsSyncedAt: EARLIER });

    await runTimelineListing(db, timelineApi([]).api, user, FENCE, NOW);

    expect((await rowOf(user, "a")).deletedAt).toBeNull();
    expect((await connectionOf(user)).timelineListedAt).toBeNull();
  });

  it("a reconnect to another volume mid-tick aborts the listing without writing", async () => {
    const user = await newConnectedUser();
    await seed(user, "a", { detailsSyncedAt: EARLIER });
    await db
      .update(protonConnections)
      .set({ volumeId: "vol-2" })
      .where(eq(protonConnections.userId, user));

    await expect(
      runTimelineListing(db, timelineApi(["b"]).api, user, FENCE, NOW)
    ).rejects.toBeInstanceOf(ProtonConnectionChangedError);

    expect((await rowOf(user, "a")).deletedAt).toBeNull();
    expect(await rowOf(user, "b")).toBeUndefined();
    expect((await connectionOf(user)).timelineListedAt).toBeNull();
  });

  it("details selection excludes rows with details_attempts >= 3, so one bad row cannot block completion", async () => {
    const user = await newConnectedUser({ timelineListedAt: EARLIER });
    await seed(user, "bad", { detailsAttempts: PROTON_MAX_DETAILS_ATTEMPTS });
    await seed(user, "gone");

    const iterateNodes = vi.fn(async function* (uids: string[]) {
      for (const uid of uids) yield { missingUid: uid };
    });
    const api = {
      iterateNodes,
      iterateThumbnails: async function* () {},
    } as unknown as ProtonPhotosApi;
    const classifier = { modelVersion: "m", classify: vi.fn() } as unknown as PhotoClassifier;

    await expect(runDetailsStage(db, api, classifier, user, FENCE, NOW)).resolves.toEqual({
      processed: 1,
    });
    expect(iterateNodes).toHaveBeenCalledWith(["gone"]);
    expect(await countPendingDetails(db, user)).toBe(0);

    const conn = await connectionOf(user);
    expect(nextBackfillStep(conn, 0)).toBe("complete");
    await expect(completeBackfill(db, user, FENCE, NOW)).resolves.toBe(true);
    expect(nextBackfillStep(await connectionOf(user), 0)).toBe("done");
    // The capped row stays hidden with its error state, never exposed.
    expect(await rowOf(user, "bad")).toMatchObject({ detailsSyncedAt: null, deletedAt: null });
  });

  it("completeBackfill does nothing while rows are pending", async () => {
    const user = await newConnectedUser({ timelineListedAt: EARLIER });
    await seed(user, "pending");

    await expect(completeBackfill(db, user, FENCE, NOW)).resolves.toBe(false);
    expect((await connectionOf(user)).backfillCompletedAt).toBeNull();
  });
});
