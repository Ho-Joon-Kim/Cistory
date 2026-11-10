import { NodeType, type PhotoNode, type ThumbnailResult } from "@protontech/drive-sdk";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { photoBlocks, photos, photoThumbnails } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import { type TestDb, useTransactionalDb } from "@/db/testing/transactional-db";
import type { ProtonPhotosApi } from "@/lib/adapters/proton/client";
import { applyIngest, type IngestOutcome, prepareIngest } from "./ingest";
import type { MappedPhoto } from "./mapper";
import { ClassifierUnavailableError, type PhotoClassifier } from "./nsfw/classifier";
import {
  loadBlockedUids,
  markNodesDeleted,
  resetForReingest,
  selectDetailsBatch,
  upsertTimelineItems,
} from "./repository";
import { PROTON_ERRORS } from "./types";

const NOW = new Date("2026-11-10T03:00:00.000Z");
const EARLIER = new Date("2026-11-01T03:00:00.000Z");
const CAPTURED = new Date("2026-03-04T15:30:00.000Z");

function mapped(nodeUid: string, over: Partial<MappedPhoto> = {}): MappedPhoto {
  return {
    nodeUid,
    capturedAt: CAPTURED,
    mainPhotoNodeUid: null,
    relatedPhotoNodeUids: [],
    contentHash: "hash",
    mediaType: "image/jpeg",
    width: 4032,
    height: 3024,
    durationSec: null,
    lat: null,
    lon: null,
    device: "Pixel",
    tags: [0],
    claimedMetadata: null,
    trashedAt: null,
    ...over,
  };
}

const pass = (photo: MappedPhoto, bytes = [1, 2, 3]): IngestOutcome => ({
  kind: "pass",
  photo,
  thumbnail: new Uint8Array(bytes),
});

async function seed(db: TestDb, userId: string, nodeUid: string, over = {}) {
  const [row] = await db
    .insert(photos)
    .values({
      userId,
      nodeUid,
      capturedAt: CAPTURED,
      createdAt: EARLIER,
      updatedAt: EARLIER,
      ...over,
    })
    .returning();
  return row;
}

async function rowOf(db: TestDb, userId: string, nodeUid: string) {
  const [row] = await db
    .select()
    .from(photos)
    .where(and(eq(photos.userId, userId), eq(photos.nodeUid, nodeUid)));
  return row;
}

async function thumbnailOf(db: TestDb, photoId: string) {
  const [row] = await db.select().from(photoThumbnails).where(eq(photoThumbnails.photoId, photoId));
  return row;
}

describe("applyIngest (real Postgres)", () => {
  const ctx = useTransactionalDb();

  it("pass exposes the listed row, writes EXIF location and the thumbnail", async () => {
    const db = ctx.db();
    const user = await insertTestUser(db);
    await seed(db, user, "a", { detailsAttempts: 2, detailsError: PROTON_ERRORS.thumbnailMissing });

    await applyIngest(db, user, [pass(mapped("a", { lat: 37.5, lon: 127 }))], "m", NOW);

    const row = await rowOf(db, user, "a");
    expect(row).toMatchObject({
      detailsSyncedAt: NOW,
      detailsError: null,
      lat: 37.5,
      lon: 127,
      locationSource: "exif",
      locationCheckedAt: NOW,
      width: 4032,
      device: "Pixel",
      createdAt: EARLIER,
      updatedAt: NOW,
    });
    const thumb = await thumbnailOf(db, row.id);
    expect([...thumb.bytes]).toEqual([1, 2, 3]);
    expect(thumb.fetchedAt).toEqual(NOW);
  });

  it("pass without GPS clears a previous OwnTracks estimate and un-deletes the row", async () => {
    const db = ctx.db();
    const user = await insertTestUser(db);
    await seed(db, user, "a", {
      detailsSyncedAt: EARLIER,
      deletedAt: EARLIER,
      lat: 1,
      lon: 2,
      locationSource: "owntracks",
      locationGapSec: 60,
      locationCheckedAt: EARLIER,
    });

    await applyIngest(db, user, [pass(mapped("a"), [9])], "m", NOW);
    await applyIngest(db, user, [pass(mapped("a"), [7, 7])], "m", NOW);

    const row = await rowOf(db, user, "a");
    expect(row).toMatchObject({
      lat: null,
      lon: null,
      locationSource: null,
      locationGapSec: null,
      locationCheckedAt: null,
      deletedAt: null,
      detailsSyncedAt: NOW,
    });
    expect([...(await thumbnailOf(db, row.id)).bytes]).toEqual([7, 7]);
  });

  it("block deletes the row, its related rows and thumbnails, and records only node uids", async () => {
    const db = ctx.db();
    const user = await insertTestUser(db);
    const other = await insertTestUser(db);
    await applyIngest(db, user, [pass(mapped("main"))], "m", NOW);
    await seed(db, user, "listed-rel");
    await seed(db, user, "linked", { mainPhotoNodeUid: "main" });
    await seed(db, other, "main");
    const mainId = (await rowOf(db, user, "main")).id;

    const block: IngestOutcome = {
      kind: "block",
      nodeUid: "main",
      relatedUids: ["listed-rel", "unseen"],
    };
    await applyIngest(db, user, [block], "nsfw@1", NOW);
    await applyIngest(db, user, [block], "nsfw@2", NOW); // idempotent

    const left = await db.select().from(photos).where(eq(photos.userId, user));
    expect(left).toEqual([]);
    expect(await thumbnailOf(db, mainId)).toBeUndefined();
    const blocks = await db.select().from(photoBlocks).where(eq(photoBlocks.userId, user));
    expect(blocks.map((b) => b.nodeUid).sort()).toEqual(["linked", "listed-rel", "main", "unseen"]);
    expect(new Set(blocks.map((b) => b.modelVersion))).toEqual(new Set(["nsfw@1"]));
    expect(await loadBlockedUids(db, user)).toEqual(
      new Set(["linked", "listed-rel", "main", "unseen"])
    );
    expect(await rowOf(db, other, "main")).toBeDefined();
  });

  it("a failed create inserts a hidden placeholder and counts attempts", async () => {
    const db = ctx.db();
    const user = await insertTestUser(db);
    const failed: IngestOutcome = {
      kind: "fail",
      nodeUid: "new",
      error: PROTON_ERRORS.thumbnailMissing,
      thumbnailFailed: true,
      capturedAt: CAPTURED,
    };
    await applyIngest(db, user, [failed], "m", NOW);
    await applyIngest(
      db,
      user,
      [
        {
          kind: "fail",
          nodeUid: "new",
          error: PROTON_ERRORS.detailsUndecryptable,
          thumbnailFailed: false,
        },
      ],
      "m",
      NOW
    );
    await applyIngest(
      db,
      user,
      [
        {
          kind: "fail",
          nodeUid: "no-time",
          error: PROTON_ERRORS.detailsUndecryptable,
          thumbnailFailed: false,
        },
      ],
      "m",
      NOW
    );

    const row = await rowOf(db, user, "new");
    expect(row).toMatchObject({
      capturedAt: CAPTURED,
      detailsSyncedAt: null,
      detailsAttempts: 2,
      thumbnailAttempts: 1,
      detailsError: PROTON_ERRORS.detailsUndecryptable,
    });
    expect(await thumbnailOf(db, row.id)).toBeUndefined();
    expect((await rowOf(db, user, "no-time")).capturedAt).toEqual(NOW);
    // Placeholders stay in the details queue until they pass or exhaust attempts.
    expect(await selectDetailsBatch(db, user, 10)).toEqual(["no-time", "new"]);
  });

  it("a failed update keeps an already verified row exposed with its old thumbnail", async () => {
    const db = ctx.db();
    const user = await insertTestUser(db);
    await applyIngest(db, user, [pass(mapped("a"), [5, 5])], "m", EARLIER);

    await applyIngest(
      db,
      user,
      [
        {
          kind: "fail",
          nodeUid: "a",
          error: PROTON_ERRORS.thumbnailUnclassifiable,
          thumbnailFailed: true,
        },
      ],
      "m",
      NOW
    );

    const row = await rowOf(db, user, "a");
    expect(row).toMatchObject({
      detailsSyncedAt: EARLIER,
      detailsAttempts: 1,
      thumbnailAttempts: 1,
    });
    expect([...(await thumbnailOf(db, row.id)).bytes]).toEqual([5, 5]);
  });

  it("missing soft-deletes the node and its related rows; skip removes a non-photo row", async () => {
    const db = ctx.db();
    const user = await insertTestUser(db);
    await seed(db, user, "gone", { detailsSyncedAt: EARLIER });
    await seed(db, user, "gone-rel", { mainPhotoNodeUid: "gone", detailsSyncedAt: EARLIER });
    await seed(db, user, "keep", { detailsSyncedAt: EARLIER });
    await seed(db, user, "album");

    await applyIngest(
      db,
      user,
      [
        { kind: "missing", nodeUid: "gone" },
        { kind: "skip", nodeUid: "album" },
      ],
      "m",
      NOW
    );

    expect((await rowOf(db, user, "gone")).deletedAt).toEqual(NOW);
    expect((await rowOf(db, user, "gone-rel")).deletedAt).toEqual(NOW);
    expect((await rowOf(db, user, "keep")).deletedAt).toBeNull();
    expect(await rowOf(db, user, "album")).toBeUndefined();

    // A second deletion keeps the first deletion time.
    await markNodesDeleted(db, user, ["gone"], new Date("2026-11-11T00:00:00Z"));
    expect((await rowOf(db, user, "gone")).deletedAt).toEqual(NOW);
  });

  it("does not consume attempts when the classifier is unavailable", async () => {
    const db = ctx.db();
    const user = await insertTestUser(db);
    await seed(db, user, "a");
    const api = {
      async *iterateNodes(uids: string[]) {
        for (const uid of uids) {
          yield {
            uid,
            type: NodeType.Photo,
            photo: { captureTime: CAPTURED, relatedPhotoNodeUids: [], albums: [], tags: [] },
          } as unknown as PhotoNode;
        }
      },
      async *iterateThumbnails(uids: string[]) {
        for (const nodeUid of uids) {
          yield { nodeUid, ok: true, thumbnail: new Uint8Array([1]) } as ThumbnailResult;
        }
      },
    } as unknown as ProtonPhotosApi;
    const classifier: PhotoClassifier = {
      modelVersion: "m",
      classify: async () => {
        throw new ClassifierUnavailableError();
      },
    };

    const batch = await selectDetailsBatch(db, user, 500);
    await expect(
      (async () =>
        applyIngest(db, user, await prepareIngest(api, classifier, batch, new Set()), "m", NOW))()
    ).rejects.toBeInstanceOf(ClassifierUnavailableError);

    expect(await rowOf(db, user, "a")).toMatchObject({
      detailsAttempts: 0,
      thumbnailAttempts: 0,
      detailsSyncedAt: null,
      detailsError: null,
    });
  });
});

describe("proton repository (real Postgres)", () => {
  const ctx = useTransactionalDb();

  it("selectDetailsBatch returns hidden, live, under-attempted rows newest first", async () => {
    const db = ctx.db();
    const user = await insertTestUser(db);
    const other = await insertTestUser(db);
    const at = (iso: string) => new Date(iso);
    await seed(db, user, "old", { capturedAt: at("2020-01-01T00:00:00Z") });
    await seed(db, user, "new", { capturedAt: at("2026-01-01T00:00:00Z"), detailsAttempts: 2 });
    await seed(db, user, "exhausted", { detailsAttempts: 3 });
    await seed(db, user, "verified", { detailsSyncedAt: NOW });
    await seed(db, user, "deleted", { deletedAt: NOW });
    await seed(db, other, "foreign");

    expect(await selectDetailsBatch(db, user, 10)).toEqual(["new", "old"]);
    expect(await selectDetailsBatch(db, user, 1)).toEqual(["new"]);
  });

  it("upsertTimelineItems skips blocked uids and keeps screening state on conflict", async () => {
    const db = ctx.db();
    const user = await insertTestUser(db);
    await seed(db, user, "verified", {
      detailsSyncedAt: EARLIER,
      detailsAttempts: 1,
      deletedAt: EARLIER,
    });
    const later = new Date("2026-03-05T00:00:00Z");

    await upsertTimelineItems(
      db,
      user,
      [
        { nodeUid: "verified", captureTime: later, tags: [1, 2] },
        { nodeUid: "fresh", captureTime: later, tags: [] },
        { nodeUid: "nsfw", captureTime: later, tags: [] },
      ],
      new Set(["nsfw"])
    );

    expect(await rowOf(db, user, "verified")).toMatchObject({
      capturedAt: later,
      tags: [1, 2],
      deletedAt: null,
      detailsSyncedAt: EARLIER,
      detailsAttempts: 1,
    });
    expect(await rowOf(db, user, "fresh")).toMatchObject({
      detailsSyncedAt: null,
      detailsAttempts: 0,
    });
    expect(await rowOf(db, user, "nsfw")).toBeUndefined();
  });

  it("resetForReingest refreshes hidden rows' attempt budget but never hides a verified row", async () => {
    const db = ctx.db();
    const user = await insertTestUser(db);
    await seed(db, user, "hidden", {
      detailsAttempts: 3,
      detailsError: PROTON_ERRORS.thumbnailMissing,
    });
    await seed(db, user, "verified", { detailsSyncedAt: EARLIER, detailsAttempts: 2 });

    await resetForReingest(db, user, ["hidden", "verified", "absent"], NOW);

    expect(await rowOf(db, user, "hidden")).toMatchObject({
      detailsAttempts: 0,
      detailsError: null,
      updatedAt: NOW,
    });
    expect(await rowOf(db, user, "verified")).toMatchObject({
      detailsSyncedAt: EARLIER,
      detailsAttempts: 2,
    });
    expect(await rowOf(db, user, "absent")).toBeUndefined();
  });
});
