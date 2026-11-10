import { RateLimitedError, ServerError } from "@protontech/drive-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import type { ProtonConnection } from "@/db/schema";
import type { ProtonPhotosApi } from "@/lib/adapters/proton/client";
import { ClassifierUnavailableError, type PhotoClassifier } from "./nsfw/classifier";
import { PROTON_ERRORS } from "./types";

const m = vi.hoisted(() => ({
  calls: [] as string[],
  queries: [] as { client: number; text: string; values: unknown[] }[],
  lockAcquired: true,
  unlockFails: false,
  lockFails: null as Error | null,
  releases: [] as { client: number; err: unknown }[],
  nextClient: 0,
  processEvents: vi.fn(),
  runBaselineStage: vi.fn(),
  runTimelineListing: vi.fn(),
  runDetailsStage: vi.fn(),
  completeBackfill: vi.fn(),
  fillPhotoLocations: vi.fn(),
  runOriginalsStage: vi.fn(),
  countPendingDetails: vi.fn(),
  assertConnectionUnchanged: vi.fn(),
  clearExpiredFork: vi.fn(),
  telemetry: [] as { userId: string; source: string; outcome: "success" | "failure" }[],
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db")>();
  return {
    ...actual,
    getPool: () => ({
      connect: async () => {
        const id = ++m.nextClient;
        return {
          query: async (text: string, values: unknown[]) => {
            m.queries.push({ client: id, text, values });
            if (text.includes("pg_try_advisory_lock")) {
              m.calls.push("lock");
              if (m.lockFails) throw m.lockFails;
              return { rows: [{ locked: m.lockAcquired }] };
            }
            m.calls.push("unlock");
            if (m.unlockFails) throw new Error("connection lost");
            return { rows: [{ pg_advisory_unlock: true }] };
          },
          release: (err?: unknown) => {
            m.releases.push({ client: id, err });
          },
        };
      },
    }),
  };
});
vi.mock("@/lib/logger", () => ({ logger: m.logger }));
vi.mock("@/modules/data-status/telemetry", () => ({
  trackSourceSync: async (
    _db: unknown,
    userId: string,
    source: string,
    run: () => Promise<unknown>
  ) => {
    try {
      const result = await run();
      m.telemetry.push({ userId, source, outcome: "success" });
      return result;
    } catch (error) {
      m.telemetry.push({ userId, source, outcome: "failure" });
      throw error;
    }
  },
}));
vi.mock("./events", () => ({ processEvents: m.processEvents }));
vi.mock("./backfill", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./backfill")>();
  return {
    nextBackfillStep: actual.nextBackfillStep,
    runBaselineStage: m.runBaselineStage,
    runTimelineListing: m.runTimelineListing,
    runDetailsStage: m.runDetailsStage,
    completeBackfill: m.completeBackfill,
  };
});
vi.mock("./location", () => ({ fillPhotoLocations: m.fillPhotoLocations }));
vi.mock("./originals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./originals")>();
  return { ...actual, runOriginalsStage: m.runOriginalsStage };
});
vi.mock("./repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./repository")>();
  return {
    ...actual,
    connectionFence: (c: ProtonConnection) => {
      // Mirrors the real fence: an undecryptable uid reads as "changed".
      if (c.status !== "active" || !c.volumeId || c.uidEnc === "undecryptable") {
        throw new actual.ProtonConnectionChangedError();
      }
      return { volumeId: c.volumeId, uid: "UID-1" };
    },
    assertConnectionUnchanged: m.assertConnectionUnchanged,
    countPendingDetails: m.countPendingDetails,
  };
});
vi.mock("./connection", () => ({
  ProtonConnectionService: class {
    clearExpiredFork = m.clearExpiredFork;
  },
}));

import { ProtonConnectionChangedError } from "./repository";
import { type ProtonSyncDeps, syncAllProtonPhotos, syncProtonPhotosForUser } from "./sync";

const USER = "00000000-0000-0000-0000-0000000000aa";
const NOW = new Date("2026-11-10T03:00:00.000Z");

function connection(overrides: Partial<ProtonConnection> = {}): ProtonConnection {
  return {
    id: "c1",
    userId: USER,
    uidEnc: "enc",
    accessTokenEnc: "enc",
    refreshTokenEnc: "enc",
    keyPasswordEnc: "enc",
    status: "active",
    pendingForkSelector: null,
    pendingForkKeyEnc: null,
    pendingForkExpiresAt: null,
    volumeId: "vol-1",
    eventCursor: "ev-1",
    timelineListedAt: new Date("2026-11-01T00:00:00Z"),
    backfillCompletedAt: new Date("2026-11-02T00:00:00Z"),
    lastSyncedAt: null,
    lastError: "old error",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** A fake db: every select reads `rows` (per user), writes are recorded. */
function fakeDb(rows: ProtonConnection[]) {
  const writes: Record<string, unknown>[] = [];
  const read = async () => {
    m.calls.push("read");
    return rows;
  };
  const tx = {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          m.calls.push("write");
          writes.push(values);
        },
      }),
    }),
  };
  const db = {
    // `from()` is awaitable on its own (the all-users read) and has `where` (per user).
    select: () => ({ from: () => Object.assign(Promise.resolve(rows), { where: read }) }),
    transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    ...tx,
  };
  return { db: db as unknown as Database, writes };
}

const api = {} as ProtonPhotosApi;
const classifier: PhotoClassifier = { modelVersion: "test", classify: vi.fn() };

function deps(overrides: Partial<ProtonSyncDeps> = {}): ProtonSyncDeps {
  return {
    open: vi.fn(async () => {
      m.calls.push("open");
      return api;
    }),
    classifier,
    now: () => NOW,
    ...overrides,
  };
}

function serverError(statusCode: number) {
  const e = new ServerError("boom");
  (e as { statusCode?: number }).statusCode = statusCode;
  return e;
}

beforeEach(() => {
  m.calls = [];
  m.queries = [];
  m.releases = [];
  m.telemetry = [];
  m.lockAcquired = true;
  m.unlockFails = false;
  m.lockFails = null;
  m.nextClient = 0;
  m.processEvents.mockImplementation(async () => {
    m.calls.push("events");
    return { applied: 0, stopped: "end", classifierUnavailable: false };
  });
  m.runDetailsStage.mockImplementation(async () => {
    m.calls.push("details");
    return { processed: 0 };
  });
  m.runBaselineStage.mockImplementation(async () => m.calls.push("baseline"));
  m.runTimelineListing.mockImplementation(async () => m.calls.push("list"));
  m.completeBackfill.mockImplementation(async () => m.calls.push("complete"));
  m.runOriginalsStage.mockImplementation(async () => {
    m.calls.push("originals");
    return { recovered: 0, blocked: 0, exifChecked: 0, failed: 0, stopped: null };
  });
  m.fillPhotoLocations.mockImplementation(async () => {
    m.calls.push("location");
    return { updated: 0, settled: 0 };
  });
  m.countPendingDetails.mockResolvedValue(0);
  m.assertConnectionUnchanged.mockResolvedValue({ timelineListedAt: null });
  m.clearExpiredFork.mockResolvedValue(undefined);
});

describe("syncProtonPhotosForUser locking", () => {
  it("skips the user when pg_try_advisory_lock returns false and still releases the client", async () => {
    m.lockAcquired = false;
    const { db } = fakeDb([connection()]);
    const d = deps();

    await expect(syncProtonPhotosForUser(db, USER, d)).resolves.toBe("skipped_locked");

    expect(m.queries).toHaveLength(1);
    expect(m.queries[0].values).toEqual([`proton-sync:${USER}`]);
    expect(m.queries[0].text).toContain("hashtextextended($1, 0)");
    expect(d.open).not.toHaveBeenCalled();
    expect(m.telemetry).toEqual([]);
    expect(m.releases).toEqual([{ client: 1, err: undefined }]);
  });

  it("unlocks on the same client in finally even when the run throws", async () => {
    const { db, writes } = fakeDb([connection()]);
    m.processEvents.mockRejectedValue(new Error("network down"));

    await expect(syncProtonPhotosForUser(db, USER, deps())).rejects.toThrow("network down");

    expect(m.queries.map((q) => [q.client, q.text.includes("pg_advisory_unlock")])).toEqual([
      [1, false],
      [1, true],
    ]);
    expect(m.queries[1].values).toEqual([`proton-sync:${USER}`]);
    expect(m.releases).toEqual([{ client: 1, err: undefined }]);
    expect(writes).toEqual([
      expect.objectContaining({ lastError: PROTON_ERRORS.syncFailed, updatedAt: NOW }),
    ]);
    expect(m.telemetry).toEqual([{ userId: USER, source: "proton", outcome: "failure" }]);
  });

  it("destroys the client instead of returning it to the pool when unlock fails", async () => {
    const { db } = fakeDb([connection()]);
    m.unlockFails = true;

    await expect(syncProtonPhotosForUser(db, USER, deps())).resolves.toBe("synced");

    expect(m.releases).toHaveLength(1);
    expect(m.releases[0].err).toBeInstanceOf(Error);
  });
});

describe("syncProtonPhotosForUser unreadable or missing connections", () => {
  it("an active row whose uid cannot be decrypted is a recorded failure, not a silent skip", async () => {
    const { db, writes } = fakeDb([connection({ uidEnc: "undecryptable" })]);
    const d = deps();

    const err = await syncProtonPhotosForUser(db, USER, d).catch((e: unknown) => e);

    expect((err as Error).name).toBe("ProtonSessionUnreadableError");
    expect(d.open).not.toHaveBeenCalled();
    expect(writes).toEqual([{ lastError: PROTON_ERRORS.syncFailed, updatedAt: NOW }]);
    expect(m.telemetry).toEqual([{ userId: USER, source: "proton", outcome: "failure" }]);
    expect(m.logger.warn).toHaveBeenCalledWith("[Proton] stored session unreadable; sync failed", {
      userId: USER,
      error: "ProtonSessionUnreadableError",
    });
    expect(m.calls.at(-1)).toBe("unlock");
  });

  it("a session that fails to open (secrets undecryptable) records syncFailed and a failed attempt", async () => {
    const { db, writes } = fakeDb([connection()]);
    const decryptError = new Error("Unsupported state or unable to authenticate data");
    const d = deps({ open: vi.fn(async () => Promise.reject(decryptError)) });

    await expect(syncProtonPhotosForUser(db, USER, d)).rejects.toBe(decryptError);

    expect(writes).toEqual([{ lastError: PROTON_ERRORS.syncFailed, updatedAt: NOW }]);
    expect(m.telemetry).toEqual([{ userId: USER, source: "proton", outcome: "failure" }]);
  });

  it("a missing row stays a silent abort: no telemetry, no writes", async () => {
    const { db, writes } = fakeDb([]);
    const d = deps();

    await expect(syncProtonPhotosForUser(db, USER, d)).resolves.toBe("aborted");

    expect(d.open).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(m.telemetry).toEqual([]);
    expect(m.logger.warn).not.toHaveBeenCalled();
  });

  it("discards the client when the lock query itself throws", async () => {
    const { db } = fakeDb([connection()]);
    const broken = new Error("connection terminated");
    m.lockFails = broken;

    await expect(syncProtonPhotosForUser(db, USER, deps())).rejects.toBe(broken);

    expect(m.calls).toEqual(["lock"]); // no unlock: nothing was locked
    expect(m.releases).toEqual([{ client: 1, err: broken }]);
  });
});

describe("syncProtonPhotosForUser tick", () => {
  it("runs events before backfill and location fill after, in that order", async () => {
    // Backfilling: listed, details pending.
    const { db, writes } = fakeDb([connection({ backfillCompletedAt: null })]);
    m.countPendingDetails.mockResolvedValue(12);

    await expect(syncProtonPhotosForUser(db, USER, deps())).resolves.toBe("synced");

    expect(m.calls).toEqual([
      "lock",
      "read",
      "open",
      "events",
      "read",
      "details",
      "originals",
      "location",
      "write",
      "unlock",
    ]);
    expect(m.runDetailsStage).toHaveBeenCalledTimes(1);
    expect(m.processEvents).toHaveBeenCalledWith(
      db,
      api,
      classifier,
      expect.objectContaining({ userId: USER, eventCursor: "ev-1" }),
      { volumeId: "vol-1", uid: "UID-1" },
      NOW
    );
    expect(m.fillPhotoLocations).toHaveBeenCalledWith(db, USER, NOW);
    expect(writes).toEqual([{ lastSyncedAt: NOW, lastError: null, updatedAt: NOW }]);
  });

  it("runs the details stage after a non-details backfill step, for event-reset rows", async () => {
    const { db } = fakeDb([connection()]); // backfill done
    await syncProtonPhotosForUser(db, USER, deps());
    expect(m.calls.filter((c) => c !== "read")).toEqual([
      "lock",
      "open",
      "events",
      "details",
      "originals",
      "location",
      "write",
      "unlock",
    ]);
  });

  it("dispatches the baseline, list and complete steps", async () => {
    const step = async (row: Partial<ProtonConnection>, pending = 0) => {
      m.calls = [];
      const { db } = fakeDb([connection({ backfillCompletedAt: null, ...row })]);
      m.countPendingDetails.mockResolvedValue(pending);
      await syncProtonPhotosForUser(db, USER, deps());
      return m.calls.filter((c) => !["lock", "read", "open", "write", "unlock"].includes(c));
    };
    expect(await step({ eventCursor: null })).toEqual([
      "events",
      "baseline",
      "details",
      "originals",
      "location",
    ]);
    expect(await step({ timelineListedAt: null })).toEqual([
      "events",
      "list",
      "details",
      "originals",
      "location",
    ]);
    expect(await step({})).toEqual(["events", "complete", "details", "originals", "location"]);
  });

  it("records success via trackSourceSync on a zero-event tick (prevents stale)", async () => {
    const { db, writes } = fakeDb([connection()]);
    await expect(syncProtonPhotosForUser(db, USER, deps())).resolves.toBe("synced");
    expect(m.telemetry).toEqual([{ userId: USER, source: "proton", outcome: "success" }]);
    expect(writes).toEqual([{ lastSyncedAt: NOW, lastError: null, updatedAt: NOW }]);
    expect(m.assertConnectionUnchanged).toHaveBeenCalledWith(expect.anything(), USER, {
      volumeId: "vol-1",
      uid: "UID-1",
    });
  });

  it("rate-limited tick records an attempt without success and returns rate_limited", async () => {
    const { db, writes } = fakeDb([connection()]);
    m.processEvents.mockRejectedValue(new RateLimitedError("slow down"));

    await expect(syncProtonPhotosForUser(db, USER, deps())).resolves.toBe("rate_limited");

    expect(m.telemetry).toEqual([{ userId: USER, source: "proton", outcome: "failure" }]);
    expect(writes).toEqual([]); // last_synced_at untouched, no syncFailed
    expect(m.fillPhotoLocations).not.toHaveBeenCalled();
    expect(m.logger.warn).toHaveBeenCalled();
    expect(m.calls.at(-1)).toBe("unlock");
  });

  it("classifier unavailable: events and location still run, last_error set, no attempts consumed", async () => {
    // Backfill pending, so the details stage would run if the classifier were up.
    const { db, writes } = fakeDb([connection({ backfillCompletedAt: null })]);
    m.countPendingDetails.mockResolvedValue(40);
    m.processEvents.mockImplementation(async () => {
      m.calls.push("events");
      return { applied: 3, stopped: "classifier_unavailable", classifierUnavailable: true };
    });

    await expect(syncProtonPhotosForUser(db, USER, deps())).resolves.toBe("synced");

    // The details stage is where attempts are written; it never runs this tick.
    expect(m.runDetailsStage).not.toHaveBeenCalled();
    expect(m.fillPhotoLocations).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([
      { lastSyncedAt: NOW, lastError: PROTON_ERRORS.classifierUnavailable, updatedAt: NOW },
    ]);
    expect(m.telemetry).toEqual([{ userId: USER, source: "proton", outcome: "success" }]);
  });

  it("classifier failing inside the details stage skips the second details pass and still fills locations", async () => {
    const { db, writes } = fakeDb([connection({ backfillCompletedAt: null })]);
    m.countPendingDetails.mockResolvedValue(40);
    m.runDetailsStage.mockRejectedValue(new ClassifierUnavailableError());

    await expect(syncProtonPhotosForUser(db, USER, deps())).resolves.toBe("synced");

    expect(m.runDetailsStage).toHaveBeenCalledTimes(1);
    expect(m.fillPhotoLocations).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([
      expect.objectContaining({ lastError: PROTON_ERRORS.classifierUnavailable }),
    ]);
  });

  it("runs the originals stage after details with the tick's fence, recovery only while the classifier is up", async () => {
    const { db } = fakeDb([connection()]);
    await syncProtonPhotosForUser(db, USER, deps());
    expect(m.runOriginalsStage).toHaveBeenCalledWith(
      db,
      api,
      classifier,
      USER,
      { volumeId: "vol-1", uid: "UID-1" },
      NOW,
      expect.objectContaining({ recovery: true })
    );

    m.runOriginalsStage.mockClear();
    m.runDetailsStage.mockRejectedValue(new ClassifierUnavailableError());
    await syncProtonPhotosForUser(fakeDb([connection()]).db, USER, deps());
    // EXIF reads need no classifier and still run; recovery (which screens) does not.
    expect(m.runOriginalsStage.mock.calls[0][6]).toMatchObject({ recovery: false });
  });

  it("measures the originals deadline from the start of the tick on the injected clock", async () => {
    const { db } = fakeDb([connection()]);
    let t = 1_000;
    m.runOriginalsStage.mockImplementation(async (...args: unknown[]) => {
      const { pastDeadline } = args[6] as { pastDeadline: () => boolean };
      const before = pastDeadline();
      t += 5 * 60_000;
      return { before, after: pastDeadline() };
    });
    await syncProtonPhotosForUser(db, USER, deps({ clock: () => t }));
    const result = await m.runOriginalsStage.mock.results[0].value;
    expect(result).toEqual({ before: false, after: true });
  });

  it("an auth failure in the originals stage is handled like any other tick error", async () => {
    const { db } = fakeDb([connection()]);
    m.runOriginalsStage.mockRejectedValue(new RateLimitedError("slow down"));
    await expect(syncProtonPhotosForUser(db, USER, deps())).resolves.toBe("rate_limited");
    expect(m.fillPhotoLocations).not.toHaveBeenCalled();
  });

  it("a connection change mid-tick aborts without writing and is not a failure", async () => {
    const { db, writes } = fakeDb([connection()]);
    m.processEvents.mockRejectedValue(new ProtonConnectionChangedError());

    await expect(syncProtonPhotosForUser(db, USER, deps())).resolves.toBe("aborted");

    expect(writes).toEqual([]);
    expect(m.fillPhotoLocations).not.toHaveBeenCalled();
    expect(m.logger.error).not.toHaveBeenCalled();
  });

  it("a connection change at the final stamp is an abort, not a success", async () => {
    const { db, writes } = fakeDb([connection()]);
    m.assertConnectionUnchanged.mockRejectedValue(new ProtonConnectionChangedError());

    await expect(syncProtonPhotosForUser(db, USER, deps())).resolves.toBe("aborted");
    expect(writes).toEqual([]);
  });

  it("aborts when a refresh hands back a session with a different uid", async () => {
    const { db, writes } = fakeDb([connection()]);
    const d = deps({
      open: vi.fn(async (_db, _c, guard) => {
        expect(guard.expectedUid).toBe("UID-1");
        guard.onSessionChanged();
        throw serverError(401);
      }),
    });

    await expect(syncProtonPhotosForUser(db, USER, d)).resolves.toBe("aborted");
    expect(writes).toEqual([]);
  });

  it("an auth failure the refresher confirmed returns needs_reauth without overwriting last_error", async () => {
    const rows = [connection()];
    const { db, writes } = fakeDb(rows);
    m.processEvents.mockImplementation(async () => {
      rows[0] = connection({ status: "needs_reauth", lastError: PROTON_ERRORS.authExpired });
      throw serverError(401);
    });

    await expect(syncProtonPhotosForUser(db, USER, deps())).resolves.toBe("needs_reauth");
    expect(writes).toEqual([]);
    expect(m.telemetry).toEqual([{ userId: USER, source: "proton", outcome: "failure" }]);
  });

  it("an auth failure without a confirmed rejection is a plain sync failure, never needs_reauth", async () => {
    const { db, writes } = fakeDb([connection()]);
    m.processEvents.mockRejectedValue(serverError(401));

    await expect(syncProtonPhotosForUser(db, USER, deps())).rejects.toBeInstanceOf(ServerError);
    expect(writes).toEqual([expect.objectContaining({ lastError: PROTON_ERRORS.syncFailed })]);
    expect(writes[0]).not.toHaveProperty("status");
  });

  it("tree_removed stops the tick as needs_reauth", async () => {
    const { db, writes } = fakeDb([connection()]);
    m.processEvents.mockResolvedValue({
      applied: 1,
      stopped: "tree_removed",
      classifierUnavailable: false,
    });

    await expect(syncProtonPhotosForUser(db, USER, deps())).resolves.toBe("needs_reauth");
    expect(m.fillPhotoLocations).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(m.telemetry).toEqual([{ userId: USER, source: "proton", outcome: "failure" }]);
  });

  it("a row that is no longer active is skipped without opening a session", async () => {
    const { db } = fakeDb([connection({ status: "needs_reauth" })]);
    const d = deps();
    await expect(syncProtonPhotosForUser(db, USER, d)).resolves.toBe("aborted");
    expect(d.open).not.toHaveBeenCalled();
    expect(m.telemetry).toEqual([]);
    expect(m.calls.at(-1)).toBe("unlock");
  });
});

describe("syncAllProtonPhotos", () => {
  it("only active connections sync; pending rows get clearExpiredFork", async () => {
    const active = connection();
    const pending = connection({
      userId: "00000000-0000-0000-0000-0000000000bb",
      status: "pending",
      volumeId: null,
      pendingForkExpiresAt: new Date(NOW.getTime() - 1000),
    });
    const flagged = connection({
      userId: "00000000-0000-0000-0000-0000000000cc",
      status: "needs_reauth",
    });
    const { db } = fakeDb([active, pending, flagged]);

    await syncAllProtonPhotos(db, deps());

    expect(m.clearExpiredFork).toHaveBeenCalledTimes(1);
    expect(m.clearExpiredFork).toHaveBeenCalledWith(pending.userId);
    const locked = m.queries
      .filter((q) => q.text.includes("pg_try_advisory_lock"))
      .map((q) => q.values[0]);
    expect(locked).toEqual([`proton-sync:${USER}`]);
  });

  it("one user's failure is logged by error name only and does not stop the others", async () => {
    const other = connection({ userId: "00000000-0000-0000-0000-0000000000dd" });
    const { db } = fakeDb([connection(), other]);
    const secret = new Error("payload with private details");
    m.processEvents.mockRejectedValueOnce(secret);

    await syncAllProtonPhotos(db, deps());

    expect(m.processEvents).toHaveBeenCalledTimes(2);
    expect(m.logger.error).toHaveBeenCalledWith("[Proton] sync failed", {
      userId: USER,
      error: "Error",
    });
    expect(JSON.stringify(m.logger.error.mock.calls)).not.toContain("private details");
  });
});
