import {
  type DriveEvent,
  DriveEventType,
  type MaybeMissingPhotoNode,
  NodeType,
  type PhotoNode,
  RateLimitedError,
  ServerError,
  type ThumbnailResult,
} from "@protontech/drive-sdk";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import type { ProtonPhotosApi } from "@/lib/adapters/proton/client";
import { encryptSecret } from "@/lib/crypto";
import { EVENT_BATCH, planEventBatch, processEvents } from "./events";
import {
  ClassifierUnavailableError,
  type NsfwScores,
  type PhotoClassifier,
} from "./nsfw/classifier";
import { ProtonConnectionChangedError, type ProtonTickFence } from "./repository";
import { PROTON_ERRORS } from "./types";

const NOW = new Date("2026-11-10T03:00:00.000Z");
const USER = "00000000-0000-0000-0000-0000000000aa";
const VOL = "vol-1";
const FENCE: ProtonTickFence = { volumeId: VOL, uid: "U1" };
const CONN = { userId: USER, eventCursor: "ev-0" };
const SAFE: NsfwScores = { drawing: 0, hentai: 0, neutral: 1, porn: 0, sexy: 0 };

// ── event builders ────────────────────────────────────────────────────────────

const created = (uid: string, eventId: string, scope = VOL): DriveEvent => ({
  type: DriveEventType.NodeCreated,
  nodeUid: uid,
  isTrashed: false,
  isShared: false,
  treeEventScopeId: scope,
  eventId,
});
const updated = (uid: string, eventId: string): DriveEvent =>
  ({
    ...(created(uid, eventId) as object),
    type: DriveEventType.NodeUpdated,
  }) as DriveEvent;
const deleted = (uid: string, eventId: string): DriveEvent => ({
  type: DriveEventType.NodeDeleted,
  nodeUid: uid,
  treeEventScopeId: VOL,
  eventId,
});
const fastForward = (eventId: string): DriveEvent => ({
  type: DriveEventType.FastForward,
  treeEventScopeId: VOL,
  eventId,
});
const treeRefresh = (eventId: string): DriveEvent => ({
  type: DriveEventType.TreeRefresh,
  treeEventScopeId: VOL,
  eventId,
});
const treeRemove = (): DriveEvent => ({
  type: DriveEventType.TreeRemove,
  treeEventScopeId: VOL,
  eventId: "none",
});

function serverError(statusCode: number) {
  const e = new ServerError("boom");
  (e as { statusCode?: number }).statusCode = statusCode;
  return e;
}

function photoNode(uid: string): PhotoNode {
  return {
    uid,
    type: NodeType.Photo,
    mediaType: "image/jpeg",
    treeEventScopeId: VOL,
    photo: {
      captureTime: new Date("2026-03-04T15:30:00.000Z"),
      relatedPhotoNodeUids: [],
      albums: [],
      tags: [],
    },
    activeRevision: { claimedAdditionalMetadata: undefined },
  } as unknown as PhotoNode;
}

// ── fake db / api ─────────────────────────────────────────────────────────────

type LogEntry = { kind: "sql"; text: string; values: unknown[] } | { kind: "net"; call: string };

/** A real Drizzle instance over a fake pg client; statements are recorded in `log`. */
function recordingDb(
  log: LogEntry[],
  opts: { status?: string; volumeId?: string; blocked?: string[] } = {}
) {
  const answers: [RegExp, () => unknown[][]][] = [
    [
      /^select .* from "proton_connections".*for update/is,
      () => [[opts.status ?? "active", opts.volumeId ?? VOL, encryptSecret(FENCE.uid), NOW]],
    ],
    [/^select "node_uid" from "photo_blocks"/i, () => (opts.blocked ?? []).map((u) => [u])],
    [/^insert into "photos".*returning/is, () => [["photo-id-1"]]],
  ];
  const client = {
    query: async (config: { text: string } | string, values?: unknown[]) => {
      const text = typeof config === "string" ? config : config.text;
      log.push({ kind: "sql", text, values: values ?? [] });
      const rows = answers.find(([pattern]) => pattern.test(text))?.[1]() ?? [];
      return { rows, rowCount: rows.length, fields: [] };
    },
  };
  return drizzle({ client: client as never, schema }) as unknown as Database;
}

function fakeApi(
  log: LogEntry[],
  streams: (DriveEvent | Error)[][],
  over: Partial<ProtonPhotosApi> = {}
): ProtonPhotosApi & { iterateEvents: ReturnType<typeof vi.fn> } {
  const unused = () => {
    throw new Error("not used");
  };
  let call = 0;
  const iterateEvents = vi.fn(async function* (scope: string, cursor?: string) {
    log.push({ kind: "net", call: `events:${scope}:${cursor ?? "-"}` });
    for (const item of streams[call++] ?? []) {
      if (item instanceof Error) throw item;
      yield item;
    }
  });
  return {
    getPhotosVolumeId: unused,
    iterateTimeline: unused,
    iterateEvents,
    iterateNodes: async function* (uids: string[]) {
      log.push({ kind: "net", call: `nodes:${uids.join(",")}` });
      for (const uid of uids) yield { missingUid: uid } as MaybeMissingPhotoNode;
    },
    iterateThumbnails: unused,
    ...over,
  } as ProtonPhotosApi & { iterateEvents: ReturnType<typeof vi.fn> };
}

const classifier: PhotoClassifier = { modelVersion: "test", classify: async () => SAFE };

const sqlOf = (log: LogEntry[]) =>
  log.filter((e): e is Extract<LogEntry, { kind: "sql" }> => e.kind === "sql");
const writes = (log: LogEntry[]) =>
  sqlOf(log).filter((e) => /^(insert|update|delete)/i.test(e.text));
const connectionUpdates = (log: LogEntry[]) =>
  writes(log).filter((e) => /^update "proton_connections"/i.test(e.text));

/** Groups the log into transactions: the statements between each BEGIN and COMMIT. */
function transactions(log: LogEntry[]) {
  const txs: { text: string; values: unknown[] }[][] = [];
  let current: { text: string; values: unknown[] }[] | null = null;
  for (const e of sqlOf(log)) {
    if (/^begin/i.test(e.text)) current = [];
    else if (/^(commit|rollback)/i.test(e.text)) {
      if (current) txs.push(current);
      current = null;
    } else current?.push(e);
  }
  return txs;
}

function expectNoNetworkInsideTransactions(log: LogEntry[]) {
  let inTx = false;
  for (const e of log) {
    if (e.kind === "net") expect(inTx).toBe(false);
    else if (/^begin/i.test(e.text)) inTx = true;
    else if (/^(commit|rollback)/i.test(e.text)) inTx = false;
  }
}

// ── planEventBatch ────────────────────────────────────────────────────────────

describe("planEventBatch", () => {
  it("node_created/node_updated → upsert, node_deleted → delete, last one wins per uid", () => {
    const plan = planEventBatch(
      [
        created("a", "e1"),
        updated("b", "e2"),
        deleted("c", "e3"),
        created("d", "e4"),
        deleted("d", "e5"), // created then deleted → delete
        deleted("e", "e6"),
        created("e", "e7"), // deleted then re-created → upsert
        updated("a", "e8"), // duplicate upsert → once
      ],
      VOL,
      new Set()
    );
    expect(plan.upsertUids.sort()).toEqual(["a", "b", "e"]);
    expect(plan.deleteUids.sort()).toEqual(["c", "d"]);
    expect(plan.lastEventId).toBe("e8");
    expect(plan.treeRefresh).toBe(false);
    expect(plan.treeRemoved).toBe(false);
  });

  it("fast_forward only advances lastEventId", () => {
    expect(planEventBatch([fastForward("ff-9")], VOL, new Set())).toEqual({
      upsertUids: [],
      deleteUids: [],
      treeRefresh: false,
      treeRemoved: false,
      lastEventId: "ff-9",
    });
  });

  it("ignores events from other scopes and shared_with_me_updated", () => {
    const plan = planEventBatch(
      [
        created("a", "e1"),
        created("x", "other-1", "vol-other"),
        { type: DriveEventType.SharedWithMeUpdated, eventId: "core-1", treeEventScopeId: "core" },
      ],
      VOL,
      new Set()
    );
    expect(plan.upsertUids).toEqual(["a"]);
    // A foreign scope's event id is never stored as this volume's cursor.
    expect(plan.lastEventId).toBe("e1");
    expect(planEventBatch([created("x", "o", "vol-other")], VOL, new Set()).lastEventId).toBeNull();
  });

  it("skips blocked uids for created/updated", () => {
    const plan = planEventBatch(
      [created("blocked", "e1"), updated("blocked", "e2"), created("ok", "e3")],
      VOL,
      new Set(["blocked"])
    );
    expect(plan.upsertUids).toEqual(["ok"]);
    expect(plan.lastEventId).toBe("e3");
  });

  it("tree_refresh sets the flag and its eventId becomes the cursor", () => {
    const plan = planEventBatch([created("a", "e1"), treeRefresh("tr-2")], VOL, new Set());
    expect(plan.treeRefresh).toBe(true);
    expect(plan.lastEventId).toBe("tr-2");
  });

  it("tree_remove stops the plan: no upserts, nothing after it, and 'none' is never a cursor", () => {
    const plan = planEventBatch(
      [created("a", "e1"), deleted("b", "e2"), treeRemove(), created("c", "e3")],
      VOL,
      new Set()
    );
    expect(plan.treeRemoved).toBe(true);
    expect(plan.upsertUids).toEqual([]);
    expect(plan.deleteUids).toEqual(["b"]);
    expect(plan.lastEventId).toBe("e2");
  });
});

// ── processEvents ─────────────────────────────────────────────────────────────

describe("processEvents", () => {
  it("reads events from the stored cursor on the fenced volume", async () => {
    const log: LogEntry[] = [];
    const api = fakeApi(log, [[fastForward("ev-1")]]);

    await expect(
      processEvents(recordingDb(log), api, classifier, CONN, FENCE, NOW)
    ).resolves.toEqual({ applied: 1, stopped: "end", classifierUnavailable: false });

    expect(api.iterateEvents).toHaveBeenCalledTimes(1);
    expect(api.iterateEvents.mock.calls[0].slice(0, 2)).toEqual([VOL, "ev-0"]);
    const [update] = connectionUpdates(log);
    expect(update.text).toMatch(/set "event_cursor" = \$1, "updated_at" = \$2/i);
    expect(update.values.slice(0, 2)).toEqual(["ev-1", NOW.toISOString()]);
  });

  it("does nothing without a stored cursor (the backfill baseline comes first)", async () => {
    const log: LogEntry[] = [];
    const api = fakeApi(log, []);
    await expect(
      processEvents(recordingDb(log), api, classifier, { ...CONN, eventCursor: null }, FENCE, NOW)
    ).resolves.toEqual({ applied: 0, stopped: "end", classifierUnavailable: false });
    expect(api.iterateEvents).not.toHaveBeenCalled();
    expect(writes(log)).toEqual([]);
  });

  it("stores the cursor in the same transaction as the batch writes", async () => {
    const log: LogEntry[] = [];
    const events = Array.from({ length: EVENT_BATCH + 20 }, (_, i) =>
      i % 2 === 0 ? created(`n${i}`, `ev-${i + 1}`) : deleted(`n${i}`, `ev-${i + 1}`)
    );
    const api = fakeApi(log, [events]);

    await expect(
      processEvents(recordingDb(log), api, classifier, CONN, FENCE, NOW)
    ).resolves.toMatchObject({ applied: EVENT_BATCH + 20, stopped: "end" });

    expect(EVENT_BATCH).toBe(100);
    expectNoNetworkInsideTransactions(log);
    const txs = transactions(log);
    expect(txs).toHaveLength(2);
    txs.forEach((tx, i) => {
      // Fence first (same lock order as connect/disconnect), then the writes.
      expect(tx[0].text).toMatch(/pg_advisory_xact_lock/i);
      expect(tx[1].text).toMatch(/for update/i);
      const photoWrites = tx.filter((s) =>
        /^(insert into|update|delete from) "photos"/i.test(s.text)
      );
      expect(photoWrites.length).toBeGreaterThan(0);
      // The cursor write is the last statement of the very same transaction.
      const last = tx[tx.length - 1];
      expect(last.text).toMatch(/^update "proton_connections" set "event_cursor"/i);
      expect(last.values[0]).toBe(i === 0 ? `ev-${EVENT_BATCH}` : `ev-${EVENT_BATCH + 20}`);
    });
  });

  it("does not advance the cursor when prepare fails mid-batch", async () => {
    const log: LogEntry[] = [];
    const events = Array.from({ length: EVENT_BATCH + 2 }, (_, i) =>
      created(`n${i}`, `ev-${i + 1}`)
    );
    const api = fakeApi(log, [events], {
      iterateNodes: async function* (uids: string[]) {
        log.push({ kind: "net", call: `nodes:${uids.join(",")}` });
        if (uids.includes(`n${EVENT_BATCH}`)) throw new Error("network down");
        for (const uid of uids) yield { missingUid: uid } as MaybeMissingPhotoNode;
      },
    });

    await expect(
      processEvents(recordingDb(log), api, classifier, CONN, FENCE, NOW)
    ).rejects.toThrow("network down");

    // The first batch committed with its cursor; the failing batch wrote nothing.
    const updates = connectionUpdates(log);
    expect(updates).toHaveLength(1);
    expect(updates[0].values[0]).toBe(`ev-${EVENT_BATCH}`);
    expect(transactions(log)).toHaveLength(1);
  });

  it("classifier unavailable: stops before the failing batch, keeps the cursor and reports it (C6)", async () => {
    const log: LogEntry[] = [];
    const api = fakeApi(
      log,
      [[deleted("gone", "ev-1"), created("a", "ev-2"), fastForward("ev-3")]],
      {
        iterateNodes: async function* () {
          yield photoNode("a");
        },
        iterateThumbnails: async function* () {
          yield { nodeUid: "a", ok: true, thumbnail: new Uint8Array([0xd8, 1]) } as ThumbnailResult;
        },
      }
    );
    const broken: PhotoClassifier = {
      modelVersion: "test",
      classify: async () => {
        throw new ClassifierUnavailableError();
      },
    };

    await expect(processEvents(recordingDb(log), api, broken, CONN, FENCE, NOW)).resolves.toEqual({
      applied: 0,
      stopped: "classifier_unavailable",
      classifierUnavailable: true,
    });
    // Only the batch's deletion is written: no ingest, and the cursor stays.
    expect(connectionUpdates(log)).toEqual([]);
    expect(writes(log)).toHaveLength(1);
    expect(writes(log)[0].text).toMatch(/^update "photos" set "deleted_at"/i);
  });

  it("classifier unavailable: still applies the batch's deletions, fenced, without moving the cursor", async () => {
    const log: LogEntry[] = [];
    const api = fakeApi(log, [[deleted("gone", "ev-1"), created("a", "ev-2")]], {
      iterateNodes: async function* () {
        yield photoNode("a");
      },
      iterateThumbnails: async function* () {
        yield { nodeUid: "a", ok: true, thumbnail: new Uint8Array([0xd8, 1]) } as ThumbnailResult;
      },
    });
    const broken: PhotoClassifier = {
      modelVersion: "test",
      classify: async () => {
        throw new ClassifierUnavailableError();
      },
    };

    await expect(processEvents(recordingDb(log), api, broken, CONN, FENCE, NOW)).resolves.toEqual({
      applied: 0,
      stopped: "classifier_unavailable",
      classifierUnavailable: true,
    });

    const txs = transactions(log);
    expect(txs).toHaveLength(1);
    // (a) fence first, then the soft delete of the deleted node.
    const fence = txs[0].findIndex((s) => /from "proton_connections".*for update/is.test(s.text));
    const delAt = txs[0].findIndex((s) => /^update "photos" set "deleted_at"/i.test(s.text));
    expect(fence).toBeGreaterThanOrEqual(0);
    expect(delAt).toBeGreaterThan(fence);
    const del = txs[0][delAt];
    expect(del?.values).toContain("gone");
    // (b) the cursor and listing state are untouched.
    expect(connectionUpdates(log)).toEqual([]);
    expect(txs[0].some((s) => /^insert into "photos"/i.test(s.text))).toBe(false);
    expectNoNetworkInsideTransactions(log);
  });

  it("classifier unavailable with a changed connection: writes nothing", async () => {
    const log: LogEntry[] = [];
    const api = fakeApi(log, [[deleted("gone", "ev-1"), created("a", "ev-2")]], {
      iterateNodes: async function* () {
        yield photoNode("a");
      },
      iterateThumbnails: async function* () {
        yield { nodeUid: "a", ok: true, thumbnail: new Uint8Array([0xd8, 1]) } as ThumbnailResult;
      },
    });
    const broken: PhotoClassifier = {
      modelVersion: "test",
      classify: async () => {
        throw new ClassifierUnavailableError();
      },
    };

    await expect(
      processEvents(recordingDb(log, { volumeId: "vol-other" }), api, broken, CONN, FENCE, NOW)
    ).rejects.toBeInstanceOf(ProtonConnectionChangedError);
    expect(writes(log)).toEqual([]);
  });

  it("tree_refresh nulls timeline_listed_at and backfill_completed_at and stores the cursor", async () => {
    const log: LogEntry[] = [];
    const api = fakeApi(log, [[treeRefresh("tr-5")]]);

    await processEvents(recordingDb(log), api, classifier, CONN, FENCE, NOW);

    const [update] = connectionUpdates(log);
    expect(update.text).toMatch(
      /^update "proton_connections" set "event_cursor" = \$1, "timeline_listed_at" = \$2, "backfill_completed_at" = \$3, "updated_at" = \$4/i
    );
    expect(update.values.slice(0, 4)).toEqual(["tr-5", null, null, NOW.toISOString()]);
  });

  it("tree_remove flips needs_reauth with PROTON_ERRORS.treeRemoved and stops", async () => {
    const log: LogEntry[] = [];
    let readAfterRemove = false;
    const api = fakeApi(log, [], {
      iterateEvents: vi.fn(async function* () {
        yield deleted("gone", "ev-1");
        yield created("new", "ev-2");
        yield treeRemove();
        readAfterRemove = true;
        yield created("late", "ev-3");
      }),
    });

    await expect(
      processEvents(recordingDb(log), api, classifier, CONN, FENCE, NOW)
    ).resolves.toEqual({ applied: 3, stopped: "tree_removed", classifierUnavailable: false });

    expect(readAfterRemove).toBe(false);
    // The volume is gone: nodes are not fetched, deletions still apply.
    expect(log.some((e) => e.kind === "net" && e.call.startsWith("nodes:"))).toBe(false);
    const [update] = connectionUpdates(log);
    expect(update.text).toMatch(
      /set "status" = \$\d+, "event_cursor" = \$\d+, "last_error" = \$\d+, "updated_at"/i
    );
    expect(update.values).toEqual(
      expect.arrayContaining(["needs_reauth", "ev-2", PROTON_ERRORS.treeRemoved])
    );
    expect(update.values).not.toContain("none");
    expect(writes(log).some((w) => /^update "photos" set "deleted_at"/i.test(w.text))).toBe(true);
  });

  it.each([404, 422])(
    "cursor rejection (%i) re-baselines and resets listing like tree_refresh",
    async (status) => {
      const log: LogEntry[] = [];
      const api = fakeApi(log, [[serverError(status)], [fastForward("base-7")]]);

      await expect(
        processEvents(recordingDb(log), api, classifier, CONN, FENCE, NOW)
      ).resolves.toEqual({ applied: 0, stopped: "cursor_reset", classifierUnavailable: false });

      // Second read is the baseline: same volume, no cursor.
      expect(api.iterateEvents.mock.calls.map((c) => [c[0], c[1]])).toEqual([
        [VOL, "ev-0"],
        [VOL, undefined],
      ]);
      expectNoNetworkInsideTransactions(log);
      const [update] = connectionUpdates(log);
      expect(update.values.slice(0, 4)).toEqual(["base-7", null, null, NOW.toISOString()]);
      expect(update.text).toMatch(/"timeline_listed_at" = \$2, "backfill_completed_at" = \$3/i);
    }
  );

  it("an auth failure (401) is not a cursor rejection: it propagates and writes nothing", async () => {
    const log: LogEntry[] = [];
    const api = fakeApi(log, [[serverError(401)]]);
    await expect(
      processEvents(recordingDb(log), api, classifier, CONN, FENCE, NOW)
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(api.iterateEvents).toHaveBeenCalledTimes(1);
    expect(writes(log)).toEqual([]);
  });

  it("a rate limit propagates without writing", async () => {
    const log: LogEntry[] = [];
    const api = fakeApi(log, [[new RateLimitedError("slow down")]]);
    await expect(
      processEvents(recordingDb(log), api, classifier, CONN, FENCE, NOW)
    ).rejects.toBeInstanceOf(RateLimitedError);
    expect(writes(log)).toEqual([]);
  });

  it("node_updated resets only never-verified rows' attempts, before re-ingest, in the batch tx (C3)", async () => {
    const log: LogEntry[] = [];
    const api = fakeApi(log, [[updated("a", "ev-1")]]);

    await processEvents(recordingDb(log), api, classifier, CONN, FENCE, NOW);

    const [tx] = transactions(log);
    const reset = tx.findIndex((s) => /^update "photos" set "details_attempts"/i.test(s.text));
    expect(reset).toBeGreaterThan(1);
    // Never touches a verified row: the predicate requires details_synced_at IS NULL,
    // and nothing in the batch sets details_synced_at back to NULL.
    expect(tx[reset].text).toMatch(/"details_synced_at" is null/i);
    expect(
      tx.some((s) => /"details_synced_at" = \$\d+/.test(s.text) && s.values.includes(null))
    ).toBe(false);
    // The ingest writes (here: missing → soft delete) come after the reset.
    const ingest = tx.findIndex((s) => /^update "photos" set "deleted_at"/i.test(s.text));
    expect(ingest).toBeGreaterThan(reset);
  });

  it("aborts without writing when the connection changed since the tick started", async () => {
    const log: LogEntry[] = [];
    const api = fakeApi(log, [[deleted("a", "ev-1")]]);
    await expect(
      processEvents(recordingDb(log, { volumeId: "vol-other" }), api, classifier, CONN, FENCE, NOW)
    ).rejects.toBeInstanceOf(ProtonConnectionChangedError);
    expect(writes(log)).toEqual([]);
  });

  it("treats blocked uids as blocked without fetching them", async () => {
    const log: LogEntry[] = [];
    const api = fakeApi(log, [[created("bad", "ev-1"), created("ok", "ev-2")]]);
    await processEvents(recordingDb(log, { blocked: ["bad"] }), api, classifier, CONN, FENCE, NOW);
    const nodeCalls = log.filter((e) => e.kind === "net" && e.call.startsWith("nodes:"));
    expect(nodeCalls).toEqual([{ kind: "net", call: "nodes:ok" }]);
  });
});
