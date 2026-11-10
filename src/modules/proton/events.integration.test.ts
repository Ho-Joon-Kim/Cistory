import {
  type DriveEvent,
  DriveEventType,
  NodeType,
  type PhotoNode,
  ServerError,
} from "@protontech/drive-sdk";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { photos, protonConnections } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import type { TestDb } from "@/db/testing/transactional-db";
import type { ProtonPhotosApi } from "@/lib/adapters/proton/client";
import { encryptSecret } from "@/lib/crypto";
import { processEvents } from "./events";
import type { PhotoClassifier } from "./nsfw/classifier";
import type { ProtonTickFence } from "./repository";
import { PROTON_ERRORS } from "./types";

/**
 * processEvents end to end on real Postgres: what a batch leaves behind in
 * `photos` and `proton_connections`. processEvents opens its own
 * transactions, which the rollback-per-test helper cannot nest, so rows are
 * committed under fresh fixture users and removed afterwards (everything
 * cascades from `users`).
 */
describe("proton event processing against PostgreSQL", () => {
  const NOW = new Date("2026-11-10T03:00:00.000Z");
  const EARLIER = new Date("2026-11-01T03:00:00.000Z");
  const CAPTURED = new Date("2026-03-04T15:30:00.000Z");
  const FENCE: ProtonTickFence = { volumeId: "vol-1", uid: "U1" };
  const classifier: PhotoClassifier = {
    modelVersion: "test",
    classify: async () => ({ drawing: 0, hentai: 0, neutral: 1, porn: 0, sexy: 0 }),
  };

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

  async function newConnectedUser() {
    const userId = await insertTestUser(db as unknown as TestDb);
    created.push(userId);
    await db.insert(protonConnections).values({
      userId,
      status: "active",
      uidEnc: encryptSecret(FENCE.uid),
      volumeId: FENCE.volumeId,
      eventCursor: "ev-0",
      timelineListedAt: EARLIER,
      backfillCompletedAt: EARLIER,
      createdAt: EARLIER,
      updatedAt: EARLIER,
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

  const node = (uid: string) =>
    ({
      uid,
      type: NodeType.Photo,
      mediaType: "image/jpeg",
      treeEventScopeId: FENCE.volumeId,
      photo: { captureTime: CAPTURED, relatedPhotoNodeUids: [], albums: [], tags: [] },
      activeRevision: { claimedAdditionalMetadata: undefined },
    }) as unknown as PhotoNode;

  /** Every node decrypts, but no thumbnail arrives: each re-ingest is a `fail`. */
  function api(streams: (DriveEvent | Error)[][]): ProtonPhotosApi {
    let call = 0;
    return {
      iterateEvents: async function* () {
        for (const item of streams[call++] ?? []) {
          if (item instanceof Error) throw item;
          yield item;
        }
      },
      iterateNodes: async function* (uids: string[]) {
        for (const uid of uids) yield node(uid);
      },
      iterateThumbnails: async function* () {},
    } as unknown as ProtonPhotosApi;
  }

  const updated = (nodeUid: string, eventId: string): DriveEvent => ({
    type: DriveEventType.NodeUpdated,
    nodeUid,
    isTrashed: false,
    isShared: false,
    treeEventScopeId: FENCE.volumeId,
    eventId,
  });

  it("node_updated keeps verified rows exposed and resets only never-verified attempts (C3)", async () => {
    const user = await newConnectedUser();
    await seed(user, "verified", { detailsSyncedAt: EARLIER, detailsAttempts: 2 });
    await seed(user, "hidden", { detailsAttempts: 2 });

    const result = await processEvents(
      db,
      api([[updated("verified", "ev-1"), updated("hidden", "ev-2"), updated("fresh", "ev-3")]]),
      classifier,
      { userId: user, eventCursor: "ev-0" },
      FENCE,
      NOW
    );
    expect(result).toEqual({ applied: 3, stopped: "end", classifierUnavailable: false });

    // Verified: still exposed; the failed update only bumps its counter.
    expect(await rowOf(user, "verified")).toMatchObject({
      detailsSyncedAt: EARLIER,
      deletedAt: null,
      detailsAttempts: 3,
    });
    // Never verified: a fresh budget (reset to 0) and then this failure.
    expect(await rowOf(user, "hidden")).toMatchObject({
      detailsSyncedAt: null,
      detailsAttempts: 1,
      detailsError: PROTON_ERRORS.thumbnailMissing,
    });
    // Absent: a hidden placeholder at the node's capture time (C4).
    expect(await rowOf(user, "fresh")).toMatchObject({
      detailsSyncedAt: null,
      detailsAttempts: 1,
      capturedAt: CAPTURED,
    });
    expect(await connectionOf(user)).toMatchObject({ eventCursor: "ev-3", updatedAt: NOW });
  });

  it("tree_remove sets needs_reauth; a rejected cursor re-baselines and forgets the listing", async () => {
    const removed = await newConnectedUser();
    await processEvents(
      db,
      api([
        [{ type: DriveEventType.TreeRemove, treeEventScopeId: FENCE.volumeId, eventId: "none" }],
      ]),
      classifier,
      { userId: removed, eventCursor: "ev-0" },
      FENCE,
      NOW
    );
    expect(await connectionOf(removed)).toMatchObject({
      status: "needs_reauth",
      lastError: PROTON_ERRORS.treeRemoved,
      eventCursor: "ev-0",
    });

    const rejected = await newConnectedUser();
    const notFound = new ServerError("gone");
    (notFound as { statusCode?: number }).statusCode = 422;
    await processEvents(
      db,
      api([
        [notFound],
        [{ type: DriveEventType.FastForward, treeEventScopeId: FENCE.volumeId, eventId: "base-1" }],
      ]),
      classifier,
      { userId: rejected, eventCursor: "ev-0" },
      FENCE,
      NOW
    );
    expect(await connectionOf(rejected)).toMatchObject({
      status: "active",
      eventCursor: "base-1",
      timelineListedAt: null,
      backfillCompletedAt: null,
      updatedAt: NOW,
    });
  });
});
