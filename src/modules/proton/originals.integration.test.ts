import { readFileSync } from "node:fs";
import {
  type FileDownloader,
  NodeType,
  type PhotoNode,
  RateLimitedError,
  ServerError,
} from "@protontech/drive-sdk";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { photoBlocks, photos, photoThumbnails, protonConnections } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import type { TestDb } from "@/db/testing/transactional-db";
import type { ProtonPhotosApi } from "@/lib/adapters/proton/client";
import { encryptSecret } from "@/lib/crypto";
import { applyIngest } from "./ingest";
import { fillPhotoLocations } from "./location";
import type { MappedPhoto } from "./mapper";
import type { NsfwScores, PhotoClassifier } from "./nsfw/classifier";
import { runOriginalsStage } from "./originals";
import { ProtonConnectionChangedError, type ProtonTickFence } from "./repository";
import { withExif } from "./testing/exif-fixture";
import { sniffThumbnailFormat } from "./thumbnail-format";
import { PROTON_ERRORS, PROTON_MAX_ORIGINAL_ATTEMPTS } from "./types";

/**
 * Real-Postgres properties of the originals stage: location precedence
 * (original EXIF GPS > Proton attribute GPS > OwnTracks, and the OwnTracks
 * fill never touching either GPS source), the once-per-revision marker, the
 * fence, and thumbnail recovery's pass/block/fail writes. The stage opens its
 * own transactions, so rows are committed under fresh fixture users and
 * removed afterwards (everything cascades from `users`).
 */
describe("proton originals stage against PostgreSQL", () => {
  const NOW = new Date("2026-11-10T03:00:00.000Z");
  const EARLIER = new Date("2026-11-01T03:00:00.000Z");
  const CAPTURED = new Date("2020-05-04T06:30:00.000Z");
  const FENCE: ProtonTickFence = { volumeId: "vol-1", uid: "U1" };
  const HEIC = new Uint8Array(readFileSync(new URL("./testing/galaxy-like.heic", import.meta.url)));

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
      eventCursor: "ev-1",
      createdAt: EARLIER,
      updatedAt: EARLIER,
    });
    return userId;
  }

  async function seed(userId: string, nodeUid: string, over: Partial<typeof photos.$inferInsert>) {
    await db.insert(photos).values({
      userId,
      nodeUid,
      capturedAt: CAPTURED,
      mediaType: "image/jpeg",
      createdAt: EARLIER,
      updatedAt: EARLIER,
      ...over,
    });
  }

  const exposed = { detailsSyncedAt: EARLIER };
  const hiddenNoThumb = {
    detailsAttempts: 3,
    detailsError: PROTON_ERRORS.thumbnailMissing,
    thumbnailAttempts: 3,
  };

  async function rowOf(userId: string, nodeUid: string) {
    const [row] = await db
      .select()
      .from(photos)
      .where(and(eq(photos.userId, userId), eq(photos.nodeUid, nodeUid)));
    return row;
  }

  async function noiseJpeg(): Promise<Uint8Array> {
    return new Uint8Array(
      await sharp({
        create: {
          width: 320,
          height: 240,
          channels: 3,
          background: { r: 0, g: 0, b: 0 },
          noise: { type: "gaussian", mean: 128, sigma: 40 },
        },
      })
        .jpeg()
        .toBuffer()
    );
  }

  /** A downloader serving `bytes` through both the seekable stream and a full download. */
  function downloaderOf(bytes: Uint8Array): FileDownloader {
    let position = 0;
    return {
      getClaimedSizeInBytes: () => bytes.length,
      getSeekableStream: () => ({
        seek: async (p: number) => {
          position = p;
        },
        read: async (n: number) => {
          const value = bytes.subarray(position, Math.min(bytes.length, position + n));
          position += value.length;
          return { value, done: position >= bytes.length };
        },
      }),
      downloadToStream: (sink: WritableStream<Uint8Array>) => {
        const promise = (async () => {
          const writer = sink.getWriter();
          await writer.write(bytes);
          await writer.close();
        })();
        return {
          pause() {},
          resume() {},
          completion: () => promise,
          isDownloadCompleteWithSignatureIssues: () => false,
        };
      },
    } as unknown as FileDownloader;
  }

  function nodeOf(uid: string, mediaType = "image/heic"): PhotoNode {
    return {
      uid,
      type: NodeType.Photo,
      mediaType,
      photo: { captureTime: CAPTURED, relatedPhotoNodeUids: [], albums: [], tags: [] },
    } as unknown as PhotoNode;
  }

  function fakeApi(originals: Record<string, Uint8Array | Error>) {
    const getFileDownloader = vi.fn(async (uid: string) => {
      const o = originals[uid];
      if (o instanceof Error) throw o;
      if (!o) throw new Error("no such original");
      return downloaderOf(o);
    });
    const api = {
      async *iterateNodes(uids: string[]) {
        for (const uid of uids) yield nodeOf(uid);
      },
      getFileDownloader,
    } as unknown as ProtonPhotosApi;
    return { api, getFileDownloader };
  }

  const SAFE: NsfwScores = { drawing: 0, hentai: 0, neutral: 1, porn: 0, sexy: 0 };
  const NSFW: NsfwScores = { drawing: 0, hentai: 0, neutral: 0, porn: 0.9, sexy: 0 };

  function classifierOf(scores: NsfwScores) {
    const seen: Uint8Array[] = [];
    const classifier: PhotoClassifier = {
      modelVersion: "m-test",
      classify: async (image) => {
        seen.push(image);
        return scores;
      },
    };
    return { classifier, seen };
  }

  const run = (
    userId: string,
    api: ProtonPhotosApi,
    classifier: PhotoClassifier,
    over: { recovery?: boolean; fence?: ProtonTickFence } = {}
  ) =>
    runOriginalsStage(db, api, classifier, userId, over.fence ?? FENCE, NOW, {
      recovery: over.recovery ?? true,
      pastDeadline: () => false,
    });

  it("original GPS beats attribute GPS and an OwnTracks estimate; no GPS keeps what was there", async () => {
    const user = await newConnectedUser();
    const withGps = withExif(await noiseJpeg(), {
      lat: 35.5,
      lon: 129.25,
      direction: 200.5,
      directionRef: "T",
      offsetTimeOriginal: "+09:00",
    });
    const noGps = withExif(await noiseJpeg(), { offsetTimeOriginal: "-05:00" });

    const attr = { lat: 1.5, lon: 2.5, locationCheckedAt: EARLIER };
    await seed(user, "attr-then-orig", { ...exposed, ...attr, locationSource: "exif" });
    await seed(user, "owntracks-then-orig", {
      ...exposed,
      ...attr,
      locationSource: "owntracks",
      locationGapSec: 30,
    });
    await seed(user, "attr-no-orig-gps", { ...exposed, ...attr, locationSource: "exif" });
    await seed(user, "owntracks-no-orig-gps", {
      ...exposed,
      ...attr,
      locationSource: "owntracks",
      locationGapSec: 30,
    });
    await seed(user, "heic", { ...exposed, mediaType: "image/heic" });
    const { api } = fakeApi({
      "attr-then-orig": withGps,
      "owntracks-then-orig": withGps,
      "attr-no-orig-gps": noGps,
      "owntracks-no-orig-gps": noGps,
      heic: HEIC,
    });

    const result = await run(user, api, classifierOf(SAFE).classifier);
    expect(result).toMatchObject({ exifChecked: 5, failed: 0, stopped: null });

    for (const uid of ["attr-then-orig", "owntracks-then-orig"]) {
      const row = await rowOf(user, uid);
      expect(row).toMatchObject({
        locationSource: "exif_original",
        locationGapSec: null,
        locationCheckedAt: NOW,
        originalCheckedAt: NOW,
        imageDirection: 200.5,
        imageDirectionRef: "T",
        captureUtcOffsetMin: 540,
      });
      expect(row.lat).toBeCloseTo(35.5, 5);
      expect(row.lon).toBeCloseTo(129.25, 5);
    }
    expect(await rowOf(user, "attr-no-orig-gps")).toMatchObject({
      lat: 1.5,
      lon: 2.5,
      locationSource: "exif",
      locationCheckedAt: EARLIER,
      originalCheckedAt: NOW,
      imageDirection: null,
      captureUtcOffsetMin: -300,
    });
    expect(await rowOf(user, "owntracks-no-orig-gps")).toMatchObject({
      locationSource: "owntracks",
      locationGapSec: 30,
      originalCheckedAt: NOW,
    });
    const heic = await rowOf(user, "heic");
    expect(heic).toMatchObject({ locationSource: "exif_original", imageDirection: 123.45 });
    expect(heic.lat).toBeCloseTo(37.123456, 5);

    // Read once: a second run selects nothing and calls Proton for nothing.
    const again = fakeApi({});
    expect(await run(user, again.api, classifierOf(SAFE).classifier)).toMatchObject({
      exifChecked: 0,
    });
    expect(again.getFileDownloader).not.toHaveBeenCalled();
  });

  it("the OwnTracks fill never overwrites original GPS, and a re-ingest makes the original due again", async () => {
    const user = await newConnectedUser();
    await seed(user, "a", { ...exposed });
    const { api } = fakeApi({ a: withExif(await noiseJpeg(), { lat: 10.25, lon: 20.5 }) });
    await run(user, api, classifierOf(SAFE).classifier);
    // Pretend the fill would want this row: clear its settled stamp.
    await db.update(photos).set({ locationCheckedAt: null }).where(eq(photos.nodeUid, "a"));
    await fillPhotoLocations(db, user, NOW);
    const after = await rowOf(user, "a");
    expect(after.locationSource).toBe("exif_original");
    expect(after.lat).toBeCloseTo(10.25, 5);

    // node_updated re-ingests the photo: the marker and original fields reset,
    // and the location falls back to what Proton's attributes say.
    const photo: MappedPhoto = {
      nodeUid: "a",
      capturedAt: CAPTURED,
      mainPhotoNodeUid: null,
      relatedPhotoNodeUids: [],
      contentHash: null,
      mediaType: "image/jpeg",
      width: null,
      height: null,
      durationSec: null,
      lat: null,
      lon: null,
      device: null,
      tags: [],
      claimedMetadata: null,
      trashedAt: null,
    };
    await applyIngest(
      db,
      user,
      [{ kind: "pass", photo, thumbnail: new Uint8Array([1]) }],
      "m",
      NOW
    );
    expect(await rowOf(user, "a")).toMatchObject({
      originalCheckedAt: null,
      originalAttempts: 0,
      imageDirection: null,
      captureUtcOffsetMin: null,
      lat: null,
      locationSource: null,
    });
  });

  it("skips videos, hidden, deleted and foreign rows", async () => {
    const user = await newConnectedUser();
    const other = await newConnectedUser();
    await seed(user, "video", { ...exposed, mediaType: "video/quicktime" });
    await seed(user, "hidden", {});
    await seed(user, "deleted", { ...exposed, deletedAt: EARLIER });
    await seed(user, "exhausted", { ...exposed, originalAttempts: PROTON_MAX_ORIGINAL_ATTEMPTS });
    await seed(other, "foreign", { ...exposed });
    const { api, getFileDownloader } = fakeApi({});

    expect(await run(user, api, classifierOf(SAFE).classifier)).toMatchObject({ exifChecked: 0 });
    expect(getFileDownloader).not.toHaveBeenCalled();
    expect((await rowOf(other, "foreign")).originalCheckedAt).toBeNull();
  });

  it("a changed connection writes nothing", async () => {
    const user = await newConnectedUser();
    await seed(user, "a", { ...exposed });
    const { api } = fakeApi({ a: withExif(await noiseJpeg(), { lat: 10.25, lon: 20.5 }) });

    await expect(
      run(user, api, classifierOf(SAFE).classifier, { fence: { volumeId: "vol-1", uid: "U2" } })
    ).rejects.toBeInstanceOf(ProtonConnectionChangedError);
    expect(await rowOf(user, "a")).toMatchObject({
      originalCheckedAt: null,
      originalAttempts: 0,
      locationSource: null,
    });
  });

  it("charges per-photo failures, permanently for an oversized original, and stops on an outage", async () => {
    const user = await newConnectedUser();
    const outage = new ServerError("unavailable");
    (outage as { statusCode?: number }).statusCode = 503;
    await seed(user, "newest", { ...exposed, capturedAt: new Date("2020-05-06T00:00:00Z") });
    await seed(user, "middle", { ...exposed, capturedAt: new Date("2020-05-05T00:00:00Z") });
    await seed(user, "oldest", { ...exposed, capturedAt: new Date("2020-05-04T00:00:00Z") });

    const huge = fakeApi({});
    huge.getFileDownloader.mockImplementation(async (uid: string) => {
      if (uid === "newest") throw new Error("decryption failed");
      if (uid === "middle") {
        return {
          ...downloaderOf(new Uint8Array(10)),
          getClaimedSizeInBytes: () => 64 * 1024 * 1024,
          getSeekableStream: () => {
            throw new Error("no block sizes");
          },
        } as unknown as FileDownloader;
      }
      throw outage;
    });

    expect(await run(user, huge.api, classifierOf(SAFE).classifier)).toMatchObject({
      exifChecked: 0,
      failed: 2,
      stopped: "outage",
    });
    expect(await rowOf(user, "newest")).toMatchObject({
      originalAttempts: 1,
      originalError: PROTON_ERRORS.originalUnavailable,
      originalCheckedAt: null,
    });
    expect(await rowOf(user, "middle")).toMatchObject({
      originalAttempts: PROTON_MAX_ORIGINAL_ATTEMPTS,
      originalError: PROTON_ERRORS.originalTooLarge,
    });
    expect(await rowOf(user, "oldest")).toMatchObject({ originalAttempts: 0, originalError: null });
  });

  it("recovers a thumbnail-less hidden photo from its HEIC original, whatever its details attempts", async () => {
    const user = await newConnectedUser();
    await seed(user, "no-thumb", { ...hiddenNoThumb, mediaType: null });
    const { api } = fakeApi({ "no-thumb": HEIC });
    const { classifier, seen } = classifierOf(SAFE);

    expect(await run(user, api, classifier)).toMatchObject({ recovered: 1, blocked: 0, failed: 0 });

    const row = await rowOf(user, "no-thumb");
    expect(row).toMatchObject({
      detailsSyncedAt: NOW,
      detailsError: null,
      mediaType: "image/heic",
      originalCheckedAt: NOW,
      locationSource: "exif_original",
      imageDirection: 123.45,
      imageDirectionRef: "T",
      captureUtcOffsetMin: 540,
    });
    const [thumb] = await db
      .select()
      .from(photoThumbnails)
      .where(eq(photoThumbnails.photoId, row.id));
    // The stored bytes are exactly the screened bytes, a JPEG.
    expect(seen).toHaveLength(1);
    expect(new Uint8Array(thumb.bytes)).toEqual(seen[0]);
    expect(sniffThumbnailFormat(new Uint8Array(thumb.bytes))).toBe("jpeg");
  });

  it("a recovered thumbnail that fails screening deletes the row and leaves only photo_blocks", async () => {
    const user = await newConnectedUser();
    await seed(user, "bad", { ...hiddenNoThumb });
    const { api } = fakeApi({ bad: HEIC });

    expect(await run(user, api, classifierOf(NSFW).classifier)).toMatchObject({ blocked: 1 });

    expect(await rowOf(user, "bad")).toBeUndefined();
    const blocks = await db.select().from(photoBlocks).where(eq(photoBlocks.userId, user));
    expect(blocks.map((b) => [b.nodeUid, b.modelVersion])).toEqual([["bad", "m-test"]]);
  });

  it("stays fail-closed when the original cannot be decoded either", async () => {
    const user = await newConnectedUser();
    await seed(user, "junk", { ...hiddenNoThumb });
    const { api } = fakeApi({ junk: new Uint8Array(4096).fill(9) });
    const { classifier, seen } = classifierOf(SAFE);

    expect(await run(user, api, classifier)).toMatchObject({ recovered: 0, failed: 1 });

    expect(seen).toHaveLength(0);
    const row = await rowOf(user, "junk");
    expect(row).toMatchObject({
      detailsSyncedAt: null,
      detailsError: PROTON_ERRORS.thumbnailMissing,
      originalAttempts: PROTON_MAX_ORIGINAL_ATTEMPTS,
      originalError: PROTON_ERRORS.originalUndecodable,
    });
    expect(
      await db.select().from(photoThumbnails).where(eq(photoThumbnails.photoId, row.id))
    ).toEqual([]);
  });

  it("skips recovery but still reads EXIF when the classifier is down", async () => {
    const user = await newConnectedUser();
    await seed(user, "no-thumb", { ...hiddenNoThumb });
    await seed(user, "exposed", { ...exposed });
    const { api, getFileDownloader } = fakeApi({
      exposed: withExif(await noiseJpeg(), { offsetTimeOriginal: "+01:00" }),
    });

    expect(await run(user, api, classifierOf(SAFE).classifier, { recovery: false })).toMatchObject({
      recovered: 0,
      exifChecked: 1,
    });
    expect(getFileDownloader.mock.calls.map((c) => c[0])).toEqual(["exposed"]);
    expect((await rowOf(user, "no-thumb")).originalAttempts).toBe(0);
  });

  it("starts no original past the tick deadline, and lets session errors reach the tick", async () => {
    const user = await newConnectedUser();
    await seed(user, "a", { ...exposed });
    await seed(user, "no-thumb", { ...hiddenNoThumb });
    const { api, getFileDownloader } = fakeApi({ a: HEIC, "no-thumb": HEIC });
    const late = await runOriginalsStage(db, api, classifierOf(SAFE).classifier, user, FENCE, NOW, {
      recovery: true,
      pastDeadline: () => true,
    });
    expect(late).toMatchObject({ stopped: "deadline", recovered: 0, exifChecked: 0 });
    expect(getFileDownloader).not.toHaveBeenCalled();

    const expired = new ServerError("expired");
    (expired as { statusCode?: number }).statusCode = 401;
    getFileDownloader.mockRejectedValue(expired);
    await expect(run(user, api, classifierOf(SAFE).classifier)).rejects.toBe(expired);
    expect(await rowOf(user, "no-thumb")).toMatchObject({ originalAttempts: 0 });
  });

  it("a rate limit stops the stage without charging, so the tick can still fill and stamp", async () => {
    const user = await newConnectedUser();
    await seed(user, "a", { ...exposed });
    const { api, getFileDownloader } = fakeApi({});
    getFileDownloader.mockRejectedValue(new RateLimitedError("slow down"));

    expect(await run(user, api, classifierOf(SAFE).classifier)).toMatchObject({
      stopped: "rate_limited",
      failed: 0,
    });
    expect(await rowOf(user, "a")).toMatchObject({ originalAttempts: 0, originalError: null });
  });

  it("never re-exposes a related uid blocked earlier in the same batch, whatever its main attribute", async () => {
    const user = await newConnectedUser();
    const newer = new Date("2020-05-06T00:00:00Z");
    await seed(user, "main", { ...hiddenNoThumb, capturedAt: newer });
    await seed(user, "part", { ...hiddenNoThumb });
    const { getFileDownloader } = fakeApi({ main: HEIC, part: HEIC });
    const api = {
      async *iterateNodes(uids: string[]) {
        for (const uid of uids) {
          const node = nodeOf(uid) as unknown as { photo: { relatedPhotoNodeUids: string[] } };
          // Inconsistent attributes: main lists the part, the part names no main.
          if (uid === "main") node.photo.relatedPhotoNodeUids = ["part"];
          yield node as unknown as PhotoNode;
        }
      },
      getFileDownloader,
    } as unknown as ProtonPhotosApi;
    let calls = 0;
    const classifier: PhotoClassifier = {
      modelVersion: "m-test",
      classify: async () => (calls++ === 0 ? NSFW : SAFE),
    };

    expect(await run(user, api, classifier)).toMatchObject({ blocked: 2, recovered: 0 });
    expect(await rowOf(user, "part")).toBeUndefined();
    expect(getFileDownloader.mock.calls.map((c) => c[0])).toEqual(["main"]);
  });
});
