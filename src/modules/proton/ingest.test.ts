import {
  type MaybeMissingPhotoNode,
  NodeType,
  type PhotoNode,
  type ThumbnailResult,
} from "@protontech/drive-sdk";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import type { ProtonPhotosApi } from "@/lib/adapters/proton/client";
import { applyIngest, INGEST_CHUNK, prepareIngest } from "./ingest";
import {
  ClassifierUnavailableError,
  ClassifyInputError,
  type NsfwScores,
  type PhotoClassifier,
} from "./nsfw/classifier";
import { PROTON_ERRORS } from "./types";

const NOW = new Date("2026-11-10T03:00:00.000Z");
const USER = "00000000-0000-0000-0000-0000000000aa";

const SAFE: NsfwScores = { drawing: 0, hentai: 0, neutral: 1, porn: 0, sexy: 0 };
const NSFW: NsfwScores = { drawing: 0, hentai: 0.1, neutral: 0.1, porn: 0.8, sexy: 0 };

/** First byte of a fake thumbnail decides the verdict: 0xff → NSFW, anything else → safe. */
const SAFE_JPEG = () => new Uint8Array([0xd8, 1, 2, 3]);
const NSFW_JPEG = () => new Uint8Array([0xff, 9, 9, 9]);

function photoNode(uid: string, photo: Record<string, unknown> = {}, over = {}): PhotoNode {
  return {
    uid,
    type: NodeType.Photo,
    mediaType: "image/jpeg",
    treeEventScopeId: "scope",
    photo: {
      captureTime: new Date("2026-03-04T15:30:00.000Z"),
      relatedPhotoNodeUids: [],
      albums: [],
      tags: [],
      ...photo,
    },
    activeRevision: { claimedAdditionalMetadata: undefined },
    ...over,
  } as unknown as PhotoNode;
}

function fakeApi(
  nodes: Record<string, MaybeMissingPhotoNode>,
  thumbs: Record<string, Uint8Array | "fail">
) {
  const iterateNodes = vi.fn(async function* (uids: string[]) {
    for (const uid of uids) yield nodes[uid] ?? { missingUid: uid };
  });
  const iterateThumbnails = vi.fn(async function* (uids: string[]) {
    for (const uid of uids) {
      const t = thumbs[uid];
      if (t === undefined) continue;
      yield (
        t === "fail"
          ? { nodeUid: uid, ok: false, error: "download failed" }
          : { nodeUid: uid, ok: true, thumbnail: t }
      ) as ThumbnailResult;
    }
  });
  const unused = () => {
    throw new Error("not used by ingest");
  };
  const api: ProtonPhotosApi = {
    getPhotosVolumeId: unused,
    iterateTimeline: unused,
    iterateEvents: unused,
    iterateNodes,
    iterateThumbnails,
  };
  return { api, iterateNodes, iterateThumbnails };
}

function fakeClassifier(impl?: (jpeg: Uint8Array) => Promise<NsfwScores>) {
  const classify = vi.fn(impl ?? (async (jpeg: Uint8Array) => (jpeg[0] === 0xff ? NSFW : SAFE)));
  const classifier: PhotoClassifier = { modelVersion: "test", classify };
  return { classifier, classify };
}

interface RecordedQuery {
  text: string;
  values: unknown[];
}

/**
 * A real Drizzle instance over a fake pg client: every statement is recorded
 * (SQL text + bound params) and answered with an empty result, except an
 * `INSERT INTO photos … RETURNING` which yields one id.
 */
function recordingDb() {
  const queries: RecordedQuery[] = [];
  const client = {
    query: async (config: { text: string } | string, values?: unknown[]) => {
      const text = typeof config === "string" ? config : config.text;
      queries.push({ text, values: values ?? [] });
      if (/^insert into "photos"/i.test(text) && /returning/i.test(text)) {
        return { rows: [["photo-id-1"]], rowCount: 1, fields: [] };
      }
      return { rows: [], rowCount: 0, fields: [] };
    },
  };
  const db = drizzle({ client: client as never, schema });
  const touching = (table: string) => queries.filter((q) => q.text.includes(`"${table}"`));
  return { db, queries, touching };
}

function containsBytes(values: unknown[], bytes: Uint8Array): boolean {
  return values.some(
    (v) =>
      v instanceof Uint8Array &&
      v.length === bytes.length &&
      v.every((byte, i) => byte === bytes[i])
  );
}

describe("prepareIngest + applyIngest", () => {
  it("stores row + thumbnail only after a passing verdict", async () => {
    const jpeg = SAFE_JPEG();
    const { api } = fakeApi({ a: photoNode("a") }, { a: jpeg });
    const { classifier, classify } = fakeClassifier();

    const outcomes = await prepareIngest(api, classifier, ["a"], new Set());
    expect(classify).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([
      { kind: "pass", photo: expect.objectContaining({ nodeUid: "a" }), thumbnail: jpeg },
    ]);

    const { db, queries } = recordingDb();
    await applyIngest(db, USER, outcomes, "test", NOW);
    expect(queries.map((q) => q.text.split(" ").slice(0, 3).join(" "))).toEqual([
      'insert into "photos"',
      'insert into "photo_thumbnails"',
    ]);
    expect(queries[0].text).toMatch(/"details_synced_at"/);
    expect(queries[0].values).toContain(NOW.toISOString());
    expect(containsBytes(queries[1].values, jpeg)).toBe(true);
  });

  it("blocked: deletes the listed row, writes photo_blocks only, never writes thumbnail bytes", async () => {
    const jpeg = NSFW_JPEG();
    const { api } = fakeApi({ a: photoNode("a") }, { a: jpeg });
    const { classifier } = fakeClassifier();

    const outcomes = await prepareIngest(api, classifier, ["a"], new Set());
    expect(outcomes).toEqual([{ kind: "block", nodeUid: "a", relatedUids: [] }]);

    const { db, queries, touching } = recordingDb();
    await applyIngest(db, USER, outcomes, "nsfw@1", NOW);
    expect(queries.map((q) => q.text.split(" ").slice(0, 3).join(" "))).toEqual([
      'delete from "photos"',
      'insert into "photo_blocks"',
    ]);
    expect(touching("photo_thumbnails")).toEqual([]);
    expect(queries.some((q) => containsBytes(q.values, jpeg))).toBe(false);
    expect(queries[1].values).toEqual(expect.arrayContaining([USER, "a", "nsfw@1"]));
    expect(queries[1].text).toMatch(/on conflict .* do nothing/i);
  });

  it("blocks related photos of a blocked main without classifying them", async () => {
    const mainJpeg = NSFW_JPEG();
    const { api } = fakeApi(
      {
        main: photoNode("main", { relatedPhotoNodeUids: ["rel"] }),
        rel: photoNode("rel", { mainPhotoNodeUid: "main" }),
      },
      { main: mainJpeg, rel: SAFE_JPEG() }
    );
    const { classifier, classify } = fakeClassifier();

    // Related first in input order: mains are still screened before their related photos.
    const outcomes = await prepareIngest(api, classifier, ["rel", "main"], new Set());
    expect(classify).toHaveBeenCalledTimes(1);
    expect(classify).toHaveBeenCalledWith(mainJpeg);
    expect(outcomes.filter((o) => o.kind !== "block")).toEqual([]);
    expect(outcomes).toContainEqual({ kind: "block", nodeUid: "main", relatedUids: ["rel"] });

    const { db, touching } = recordingDb();
    await applyIngest(db, USER, outcomes, "test", NOW);
    const blockedUids = touching("photo_blocks").flatMap((q) => q.values);
    expect(blockedUids).toEqual(expect.arrayContaining(["main", "rel"]));
    expect(touching("photo_thumbnails")).toEqual([]);
  });

  it("drops a related photo that passed in an earlier chunk once its main is blocked", async () => {
    const filler = Array.from({ length: INGEST_CHUNK - 1 }, (_, i) => `f${i}`);
    const uids = ["rel", ...filler, "main"]; // rel in chunk 1, main in chunk 2
    const nodes: Record<string, MaybeMissingPhotoNode> = {
      rel: photoNode("rel", { mainPhotoNodeUid: "main" }),
      main: photoNode("main", { relatedPhotoNodeUids: ["rel"] }),
    };
    const thumbs: Record<string, Uint8Array> = { rel: SAFE_JPEG(), main: NSFW_JPEG() };
    for (const f of filler) {
      nodes[f] = photoNode(f);
      thumbs[f] = SAFE_JPEG();
    }
    const { api } = fakeApi(nodes, thumbs);
    const { classifier } = fakeClassifier();

    const outcomes = await prepareIngest(api, classifier, uids, new Set());
    const passed = outcomes.flatMap((o) => (o.kind === "pass" ? [o.photo.nodeUid] : []));
    expect(passed).not.toContain("rel");
    expect(passed).toHaveLength(filler.length);
    expect(outcomes).toContainEqual({ kind: "block", nodeUid: "main", relatedUids: ["rel"] });
  });

  it("blocks a related node whose main is already in photo_blocks", async () => {
    const { api, iterateThumbnails } = fakeApi(
      { rel: photoNode("rel", { mainPhotoNodeUid: "main" }) },
      { rel: SAFE_JPEG() }
    );
    const { classifier, classify } = fakeClassifier();

    const outcomes = await prepareIngest(api, classifier, ["rel"], new Set(["main"]));
    expect(classify).not.toHaveBeenCalled();
    expect(iterateThumbnails).not.toHaveBeenCalled();
    expect(outcomes).toEqual([{ kind: "block", nodeUid: "rel", relatedUids: [] }]);
  });

  it("skips uids already in photo_blocks before any network call", async () => {
    const { api, iterateNodes, iterateThumbnails } = fakeApi(
      { a: photoNode("a"), b: photoNode("b") },
      { a: SAFE_JPEG(), b: SAFE_JPEG() }
    );
    const { classifier, classify } = fakeClassifier();

    const outcomes = await prepareIngest(api, classifier, ["b", "a"], new Set(["b"]));
    expect(iterateNodes).toHaveBeenCalledTimes(1);
    expect(iterateNodes.mock.calls[0][0]).toEqual(["a"]);
    expect(iterateThumbnails.mock.calls[0][0]).toEqual(["a"]);
    expect(classify).toHaveBeenCalledTimes(1);
    // The blocked uid is re-asserted (idempotent) so no stale row can linger.
    expect(outcomes).toContainEqual({ kind: "block", nodeUid: "b", relatedUids: [] });
    expect(outcomes.find((o) => o.kind === "pass")).toMatchObject({ photo: { nodeUid: "a" } });
  });

  it("fail-closed: classify throws ClassifyInputError → fail outcome, no thumbnail write, attempts+1", async () => {
    const jpeg = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic
    const { api } = fakeApi({ a: photoNode("a") }, { a: jpeg });
    const { classifier } = fakeClassifier(async () => {
      throw new ClassifyInputError();
    });

    const outcomes = await prepareIngest(api, classifier, ["a"], new Set());
    expect(outcomes).toEqual([
      {
        kind: "fail",
        nodeUid: "a",
        error: PROTON_ERRORS.thumbnailUnclassifiable,
        thumbnailFailed: true,
        capturedAt: new Date("2026-03-04T15:30:00.000Z"),
      },
    ]);

    const { db, queries, touching } = recordingDb();
    await applyIngest(db, USER, outcomes, "test", NOW);
    expect(touching("photo_thumbnails")).toEqual([]);
    expect(queries).toHaveLength(1);
    expect(queries[0].text).toMatch(/"details_attempts" = "photos"."details_attempts" \+ 1/);
    // Never verified: the column only appears as `default` in the insert list, never in the update.
    expect(queries[0].text.split("do update set")[1]).not.toMatch(/"details_synced_at"/);
    expect(queries[0].values).toContain(PROTON_ERRORS.thumbnailUnclassifiable);
    expect(queries.some((q) => containsBytes(q.values, jpeg))).toBe(false);
  });

  it("fail-closed: thumbnail result ok:false → fail with thumbnailFailed, attempts+1 on both counters", async () => {
    const { api } = fakeApi({ a: photoNode("a"), b: photoNode("b") }, { a: "fail" });
    const { classifier, classify } = fakeClassifier();

    const outcomes = await prepareIngest(api, classifier, ["a", "b"], new Set());
    expect(classify).not.toHaveBeenCalled();
    for (const uid of ["a", "b"]) {
      // `a` reported ok:false; `b` was never returned at all — both count as no thumbnail.
      expect(outcomes).toContainEqual(
        expect.objectContaining({
          kind: "fail",
          nodeUid: uid,
          error: PROTON_ERRORS.thumbnailMissing,
          thumbnailFailed: true,
        })
      );
    }

    const { db, queries, touching } = recordingDb();
    await applyIngest(db, USER, outcomes.slice(0, 1), "test", NOW);
    expect(touching("photo_thumbnails")).toEqual([]);
    expect(queries[0].text).toMatch(/"details_attempts" = "photos"."details_attempts" \+ 1/);
    expect(queries[0].text).toMatch(/"thumbnail_attempts" = "photos"."thumbnail_attempts" \+ 1/);
  });

  it("does not consume attempts when the classifier is unavailable", async () => {
    const { api } = fakeApi(
      { a: photoNode("a"), b: photoNode("b"), c: photoNode("c") },
      { a: SAFE_JPEG(), b: SAFE_JPEG(), c: SAFE_JPEG() }
    );
    let call = 0;
    const { classifier } = fakeClassifier(async () => {
      call += 1;
      if (call === 1) throw new ClassifyInputError(); // would have been a per-photo failure
      if (call === 2) throw new ClassifierUnavailableError();
      return SAFE;
    });
    const { db, queries } = recordingDb();

    // The caller's shape: prepare with no transaction open, then apply.
    const tick = async () => {
      const outcomes = await prepareIngest(api, classifier, ["a", "b", "c"], new Set());
      await applyIngest(db, USER, outcomes, "test", NOW);
    };
    await expect(tick()).rejects.toBeInstanceOf(ClassifierUnavailableError);
    // Not even the photo that already failed before the outage had an attempt written.
    expect(queries).toEqual([]);
  });

  it("treats an unexpected classifier fault as unavailable, never as a per-photo verdict", async () => {
    const { api } = fakeApi({ a: photoNode("a") }, { a: SAFE_JPEG() });
    const { classifier } = fakeClassifier(async () => {
      throw new RangeError("tensor backend crashed");
    });
    await expect(prepareIngest(api, classifier, ["a"], new Set())).rejects.toBeInstanceOf(
      ClassifierUnavailableError
    );
  });

  it("missing node → soft delete including related rows", async () => {
    const { api, iterateThumbnails } = fakeApi({}, {});
    const { classifier } = fakeClassifier();

    const outcomes = await prepareIngest(api, classifier, ["gone"], new Set());
    expect(outcomes).toEqual([{ kind: "missing", nodeUid: "gone" }]);
    expect(iterateThumbnails).not.toHaveBeenCalled();

    const { db, queries } = recordingDb();
    await applyIngest(db, USER, outcomes, "test", NOW);
    expect(queries).toHaveLength(1);
    expect(queries[0].text).toMatch(/^update "photos" set "deleted_at"/);
    expect(queries[0].text).toMatch(/"main_photo_node_uid" in/);
    expect(queries[0].values).toEqual(expect.arrayContaining(["gone", NOW.toISOString()]));
  });

  it("maps degraded nodes to a fixed-string failure and non-photos to skip", async () => {
    const { api } = fakeApi(
      {
        bad: photoNode("bad", {}, { errors: [new Error("decrypt: secret payload")] }),
        album: photoNode("album", {}, { type: NodeType.Album }),
      },
      {}
    );
    const { classifier } = fakeClassifier();
    const outcomes = await prepareIngest(api, classifier, ["bad", "album"], new Set());
    expect(outcomes).toContainEqual({
      kind: "fail",
      nodeUid: "bad",
      error: PROTON_ERRORS.detailsUndecryptable,
      thumbnailFailed: false,
      capturedAt: new Date("2026-03-04T15:30:00.000Z"),
    });
    expect(outcomes).toContainEqual({ kind: "skip", nodeUid: "album" });

    const { db, queries } = recordingDb();
    await applyIngest(db, USER, outcomes, "test", NOW);
    expect(queries.some((q) => q.values.includes("decrypt: secret payload"))).toBe(false);
    expect(queries.some((q) => /^delete from "photos"/.test(q.text))).toBe(true);
  });

  it(`fetches nodes and thumbnails in chunks of ${INGEST_CHUNK}`, async () => {
    const uids = Array.from({ length: 120 }, (_, i) => `n${i}`);
    const { api, iterateNodes, iterateThumbnails } = fakeApi(
      Object.fromEntries(uids.map((u) => [u, photoNode(u)])),
      Object.fromEntries(uids.map((u) => [u, SAFE_JPEG()]))
    );
    const { classifier } = fakeClassifier();
    const outcomes = await prepareIngest(api, classifier, uids, new Set());
    expect(iterateNodes.mock.calls.map((c) => c[0].length)).toEqual([50, 50, 20]);
    expect(iterateThumbnails.mock.calls.map((c) => c[0].length)).toEqual([50, 50, 20]);
    expect(outcomes.filter((o) => o.kind === "pass")).toHaveLength(120);
  });

  it("yields to the event loop between classifications", async () => {
    const order: string[] = [];
    const { api } = fakeApi(
      { a: photoNode("a"), b: photoNode("b") },
      { a: SAFE_JPEG(), b: SAFE_JPEG() }
    );
    const { classifier } = fakeClassifier(async () => {
      order.push("classify");
      if (order.length === 1) setImmediate(() => order.push("macrotask"));
      return SAFE;
    });
    await prepareIngest(api, classifier, ["a", "b"], new Set());
    // A macrotask queued during the first classification ran before the second one started.
    expect(order).toEqual(["classify", "macrotask", "classify"]);
  });
});
