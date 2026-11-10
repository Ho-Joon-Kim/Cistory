import { type DriveEvent, DriveEventType } from "@protontech/drive-sdk";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import type { ProtonPhotosApi } from "@/lib/adapters/proton/client";
import { encryptSecret } from "@/lib/crypto";
import {
  captureBaselineCursor,
  DETAILS_BATCH_LIMIT,
  nextBackfillStep,
  runDetailsStage,
  runTimelineListing,
} from "./backfill";
import { INGEST_CHUNK } from "./ingest";
import type { NsfwScores, PhotoClassifier } from "./nsfw/classifier";
import { ProtonConnectionChangedError, type ProtonTickFence } from "./repository";

const NOW = new Date("2026-11-10T03:00:00.000Z");
const USER = "00000000-0000-0000-0000-0000000000aa";
const FENCE: ProtonTickFence = { volumeId: "vol-1", uid: "U1" };
const SAFE: NsfwScores = { drawing: 0, hentai: 0, neutral: 1, porn: 0, sexy: 0 };

/** One shared log so network calls and SQL statements can be ordered against each other. */
type LogEntry = { kind: "sql"; text: string; values: unknown[] } | { kind: "net"; call: string };

interface Responders {
  /** Row for `SELECT … FROM proton_connections` (fence + listing guard), in select order. */
  connection?: { timelineListedAt?: Date | null; status?: string; volumeId?: string; uid?: string };
  /** Node uids `selectDetailsBatch` hands out. */
  pending?: string[];
}

/**
 * A real Drizzle instance over a fake pg client. Statements are recorded in
 * `log` and answered from `responders`; everything else returns no rows.
 */
function recordingDb(log: LogEntry[], responders: Responders = {}) {
  const conn = {
    timelineListedAt: null,
    status: "active",
    volumeId: FENCE.volumeId,
    uid: FENCE.uid,
    ...responders.connection,
  };
  const client = {
    query: async (config: { text: string } | string, values?: unknown[]) => {
      const text = typeof config === "string" ? config : config.text;
      log.push({ kind: "sql", text, values: values ?? [] });
      const ok = (rows: unknown[][]) => ({ rows, rowCount: rows.length, fields: [] });
      if (/^select .* from "proton_connections"/i.test(text)) {
        if (/for update/i.test(text)) {
          return ok([[conn.status, conn.volumeId, encryptSecret(conn.uid)]]);
        }
        return ok([[conn.timelineListedAt]]);
      }
      if (/^select "node_uid" from "photos"/i.test(text)) {
        return ok((responders.pending ?? []).map((uid) => [uid]));
      }
      if (/^insert into "photos"/i.test(text) && /returning/i.test(text)) {
        return ok([["photo-id-1"]]);
      }
      return ok([]);
    },
  };
  return drizzle({ client: client as never, schema }) as unknown as Database;
}

function fakeApi(log: LogEntry[], over: Partial<ProtonPhotosApi> = {}): ProtonPhotosApi {
  const unused = () => {
    throw new Error("not used");
  };
  return {
    getPhotosVolumeId: unused,
    iterateTimeline: unused,
    iterateEvents: unused,
    iterateNodes: async function* (uids: string[]) {
      log.push({ kind: "net", call: `nodes:${uids.length}` });
      for (const uid of uids) yield { missingUid: uid };
    },
    // Every fake node is missing, so ingest never asks for a thumbnail.
    iterateThumbnails: unused,
    ...over,
  };
}

const classifier: PhotoClassifier = { modelVersion: "test", classify: async () => SAFE };

const sql = (log: LogEntry[]) =>
  log.filter((e): e is Extract<LogEntry, { kind: "sql" }> => e.kind === "sql");
const writes = (log: LogEntry[]) => sql(log).filter((e) => /^(insert|update|delete)/i.test(e.text));

describe("nextBackfillStep", () => {
  const conn = (eventCursor: string | null, listed: Date | null, completed: Date | null) => ({
    eventCursor,
    timelineListedAt: listed,
    backfillCompletedAt: completed,
  });

  it("orders steps baseline → list → details → complete → done", () => {
    expect(nextBackfillStep(conn(null, null, null), 0)).toBe("baseline");
    expect(nextBackfillStep(conn(null, NOW, null), 5)).toBe("baseline");
    expect(nextBackfillStep(conn("ev-1", null, null), 0)).toBe("list");
    expect(nextBackfillStep(conn("ev-1", NOW, null), 1)).toBe("details");
    expect(nextBackfillStep(conn("ev-1", NOW, null), 0)).toBe("complete");
    expect(nextBackfillStep(conn("ev-1", NOW, NOW), 7)).toBe("done");
  });
});

describe("runTimelineListing", () => {
  it("lists the timeline only when timeline_listed_at is null (never re-lists after)", async () => {
    const log: LogEntry[] = [];
    const iterateTimeline = vi.fn(async function* () {
      yield { nodeUid: "a", captureTime: NOW, tags: [] };
    });
    const db = recordingDb(log, { connection: { timelineListedAt: NOW } });

    await expect(
      runTimelineListing(db, fakeApi(log, { iterateTimeline }), USER, FENCE, NOW)
    ).resolves.toBe(0);

    expect(iterateTimeline).not.toHaveBeenCalled();
    expect(writes(log)).toEqual([]);
    // Once listed, no pending count ever routes back to the listing step.
    for (const pending of [0, 1, 500]) {
      expect(
        nextBackfillStep(
          { eventCursor: "ev", timelineListedAt: NOW, backfillCompletedAt: null },
          pending
        )
      ).not.toBe("list");
    }
  });

  it("an empty listing deletes nothing and records nothing as listed (C12)", async () => {
    const log: LogEntry[] = [];
    const db = recordingDb(log);
    const api = fakeApi(log, { iterateTimeline: async function* () {} });

    await expect(runTimelineListing(db, api, USER, FENCE, NOW)).resolves.toBe(0);

    expect(writes(log)).toEqual([]);
    expect(sql(log).some((e) => /^begin/i.test(e.text))).toBe(false);
  });

  it("a listing that throws midway deletes nothing and records nothing as listed (C12)", async () => {
    const log: LogEntry[] = [];
    const db = recordingDb(log);
    const api = fakeApi(log, {
      iterateTimeline: async function* () {
        yield { nodeUid: "a", captureTime: NOW, tags: [] };
        throw new Error("network down");
      },
    });

    await expect(runTimelineListing(db, api, USER, FENCE, NOW)).rejects.toThrow("network down");

    expect(writes(log)).toEqual([]);
  });

  it("writes upsert, reconcile and the listed mark in one fenced transaction", async () => {
    const log: LogEntry[] = [];
    const db = recordingDb(log);
    const api = fakeApi(log, {
      iterateTimeline: async function* () {
        yield { nodeUid: "a", captureTime: NOW, tags: [1] };
        yield { nodeUid: "b", captureTime: NOW, tags: [] };
        yield { nodeUid: "a", captureTime: NOW, tags: [1] }; // duplicate: one upsert row
      },
    });

    await expect(runTimelineListing(db, api, USER, FENCE, NOW)).resolves.toBe(2);

    const texts = sql(log).map((e) => e.text);
    const begin = texts.findIndex((t) => /^begin/i.test(t));
    const commit = texts.findIndex((t) => /^commit/i.test(t));
    expect(texts[begin + 1]).toMatch(/from "proton_connections".*for update/is);
    const inTx = writes(log).map((w) => texts.indexOf(w.text));
    expect(inTx.every((i) => i > begin && i < commit)).toBe(true);
    expect(writes(log).map((w) => w.text.split(" ").slice(0, 3).join(" "))).toEqual([
      'insert into "photos"',
      'update "photos" set',
      'update "photos" set',
      'update "proton_connections" set',
    ]);
    // The listing is bound as ONE text[] parameter, not one parameter per uid.
    const reconcile = writes(log)[1];
    expect(reconcile.values).toContainEqual(["a", "b"]);
  });

  it("aborts without writing when the connection changed since the tick started", async () => {
    const log: LogEntry[] = [];
    const db = recordingDb(log, { connection: { volumeId: "vol-other" } });
    const api = fakeApi(log, {
      iterateTimeline: async function* () {
        yield { nodeUid: "a", captureTime: NOW, tags: [] };
      },
    });

    await expect(runTimelineListing(db, api, USER, FENCE, NOW)).rejects.toBeInstanceOf(
      ProtonConnectionChangedError
    );

    expect(writes(log)).toEqual([]);
    expect(sql(log).some((e) => /^rollback/i.test(e.text))).toBe(true);
  });
});

describe("captureBaselineCursor", () => {
  it("baseline takes the fast_forward eventId from iterateEvents(volumeId) without a cursor", async () => {
    const iterateEvents = vi.fn(async function* (): AsyncGenerator<DriveEvent> {
      yield { type: DriveEventType.FastForward, treeEventScopeId: "vol-1", eventId: "ev-42" };
    });
    const api = fakeApi([], { iterateEvents });

    await expect(captureBaselineCursor(api, "vol-1")).resolves.toBe("ev-42");
    expect(iterateEvents).toHaveBeenCalledTimes(1);
    expect(iterateEvents.mock.calls[0][0]).toBe("vol-1");
    expect(iterateEvents.mock.calls[0][1]).toBeUndefined();
  });

  it("throws when the stream ends without a fast_forward", async () => {
    const api = fakeApi([], { iterateEvents: async function* () {} });
    await expect(captureBaselineCursor(api, "vol-1")).rejects.toThrow();
  });
});

describe("runDetailsStage", () => {
  it("selects at most 500 rows and applies each 50-chunk in its own fenced transaction", async () => {
    expect(DETAILS_BATCH_LIMIT).toBe(500);
    const log: LogEntry[] = [];
    const pending = Array.from({ length: 120 }, (_, i) => `p${i}`);
    const db = recordingDb(log, { pending });

    await expect(runDetailsStage(db, fakeApi(log), classifier, USER, FENCE, NOW)).resolves.toEqual({
      processed: 120,
    });

    const select = sql(log).find((e) => /^select "node_uid" from "photos"/i.test(e.text));
    expect(select?.values).toContain(DETAILS_BATCH_LIMIT);

    // Network never runs inside a transaction; each chunk = network, then begin…commit.
    const shape: string[] = [];
    let inTx = false;
    for (const e of log) {
      if (e.kind === "net") {
        expect(inTx).toBe(false);
        if (e.call.startsWith("nodes:")) shape.push(e.call);
      } else if (/^begin/i.test(e.text)) {
        inTx = true;
        shape.push("tx");
      } else if (/^commit/i.test(e.text)) {
        inTx = false;
      }
    }
    expect(shape).toEqual([
      `nodes:${INGEST_CHUNK}`,
      "tx",
      `nodes:${INGEST_CHUNK}`,
      "tx",
      "nodes:20",
      "tx",
    ]);
    // Every transaction starts with the fence check.
    const texts = sql(log).map((e) => e.text);
    texts.forEach((t, i) => {
      if (/^begin/i.test(t)) expect(texts[i + 1]).toMatch(/for update/i);
    });
  });

  it("does nothing when no row is pending", async () => {
    const log: LogEntry[] = [];
    const db = recordingDb(log, { pending: [] });
    await expect(runDetailsStage(db, fakeApi(log), classifier, USER, FENCE, NOW)).resolves.toEqual({
      processed: 0,
    });
    expect(log.some((e) => e.kind === "net")).toBe(false);
  });

  it("stops without writing the chunk when the connection changed", async () => {
    const log: LogEntry[] = [];
    const db = recordingDb(log, { pending: ["a"], connection: { status: "needs_reauth" } });

    await expect(
      runDetailsStage(db, fakeApi(log), classifier, USER, FENCE, NOW)
    ).rejects.toBeInstanceOf(ProtonConnectionChangedError);
    expect(writes(log)).toEqual([]);
  });
});
