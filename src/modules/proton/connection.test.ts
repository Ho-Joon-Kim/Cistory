import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import { type ProtonConnection, photoBlocks, photos, protonConnections } from "@/db/schema";
import type { ForkPollResult, ProtonSessionTokens } from "@/lib/adapters/proton/fork";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { type ProtonConnectionDeps, ProtonConnectionService } from "./connection";

const NOW = new Date("2026-11-10T03:00:00.000Z");
const KEY = Buffer.alloc(32, 7);

function activeRow(over: Partial<ProtonConnection> = {}): ProtonConnection {
  return {
    id: "c",
    userId: "u",
    uidEnc: encryptSecret("U-old"),
    accessTokenEnc: encryptSecret("A-old"),
    refreshTokenEnc: encryptSecret("R-old"),
    keyPasswordEnc: encryptSecret("KP-old"),
    status: "active",
    pendingForkSelector: null,
    pendingForkKeyEnc: null,
    pendingForkExpiresAt: null,
    volumeId: "vol-1",
    eventCursor: "cursor-1",
    timelineListedAt: new Date("2026-11-01T00:00:00Z"),
    backfillCompletedAt: new Date("2026-11-02T00:00:00Z"),
    lastSyncedAt: new Date("2026-11-09T00:00:00Z"),
    lastError: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    ...over,
  };
}

function pending(
  row: ProtonConnection,
  selector = "sel-1",
  expiresAt = new Date(NOW.getTime() + 60_000)
) {
  return {
    ...row,
    pendingForkSelector: selector,
    pendingForkKeyEnc: encryptSecret(KEY.toString("base64")),
    pendingForkExpiresAt: expiresAt,
  };
}

/**
 * In-memory stand-in for the three tables this service touches. Transactions
 * are serialized (like the advisory lock), and `inTx` lets the Proton fakes
 * prove no network call happens while the lock is held.
 */
function fakeDb(initial: ProtonConnection | null) {
  const state = {
    row: initial as ProtonConnection | null,
    photos: 2,
    blocks: 1,
    inserts: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
    deleted: [] as string[],
    locks: 0,
    inTx: false,
  };
  let chain: Promise<void> = Promise.resolve();
  const name = (t: unknown) =>
    t === protonConnections
      ? "proton_connections"
      : t === photos
        ? "photos"
        : t === photoBlocks
          ? "photo_blocks"
          : "?";
  const db = {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => (state.row ? [{ ...state.row }] : []) }) }),
    }),
    insert: (t: unknown) => ({
      values: async (v: Record<string, unknown>) => {
        expect(name(t)).toBe("proton_connections");
        state.inserts.push(v);
        state.row = { ...activeRow(), ...v } as ProtonConnection;
      },
    }),
    update: (t: unknown) => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => {
          expect(name(t)).toBe("proton_connections");
          state.updates.push(v);
          if (state.row) state.row = { ...state.row, ...v } as ProtonConnection;
        },
      }),
    }),
    delete: (t: unknown) => ({
      where: async () => {
        const n = name(t);
        state.deleted.push(n);
        if (n === "proton_connections") state.row = null;
        if (n === "photos") state.photos = 0;
        if (n === "photo_blocks") state.blocks = 0;
      },
    }),
    execute: async () => {
      state.locks += 1;
    },
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const previous = chain;
      let release = () => {};
      chain = new Promise((r) => {
        release = r;
      });
      await previous;
      state.inTx = true;
      try {
        return await fn(db);
      } finally {
        state.inTx = false;
        release();
      }
    },
  };
  return { db: db as unknown as Database, state };
}

const newTokens: ProtonSessionTokens = {
  uid: "U-new",
  accessToken: "A-new",
  refreshToken: "R-new",
};

function deps(state: { inTx: boolean }, over: Partial<ProtonConnectionDeps> = {}) {
  const outsideLock = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    vi.fn(async (...a: A) => {
      if (state.inTx) throw new Error("Proton call while holding the token lock");
      return fn(...a);
    });
  return {
    startFork: outsideLock(async () => ({
      selector: "sel-1",
      signInUrl: "https://account.proton.me/fork#sel-1",
      encryptionKey: KEY,
      expiresAt: new Date(NOW.getTime() + 10 * 60_000),
    })),
    pollFork: outsideLock(
      async (): Promise<ForkPollResult> => ({
        status: "ready",
        tokens: newTokens,
        keyPassword: "KP-new",
      })
    ),
    resolveVolumeId: outsideLock(async () => "vol-1"),
    revoke: outsideLock(async () => true),
    now: () => NOW,
    ...over,
  };
}

describe("ProtonConnectionService.startConnect", () => {
  it("first connect inserts a pending row with encrypted selector/key and 10-minute expiry", async () => {
    const { db, state } = fakeDb(null);
    const d = deps(state);
    const result = await new ProtonConnectionService(db, d).startConnect("u");

    expect(result).toEqual({
      signInUrl: "https://account.proton.me/fork#sel-1",
      expiresAt: new Date(NOW.getTime() + 10 * 60_000).toISOString(),
    });
    expect(state.inserts).toHaveLength(1);
    const v = state.inserts[0];
    expect(v).toMatchObject({ userId: "u", status: "pending" });
    expect(v.pendingForkSelector).toBe("sel-1");
    expect(decryptSecret(v.pendingForkKeyEnc as string)).toBe(KEY.toString("base64"));
    expect(v.pendingForkExpiresAt).toEqual(new Date(NOW.getTime() + 10 * 60_000));
    expect(v.uidEnc ?? null).toBeNull();
    expect(v.createdAt).toBeInstanceOf(Date);
    expect(v.updatedAt).toBeInstanceOf(Date);
    expect(state.locks).toBe(1);
  });

  it("re-connect on an active row writes only pending_* and keeps status and tokens", async () => {
    const { db, state } = fakeDb(activeRow());
    await new ProtonConnectionService(db, deps(state)).startConnect("u");

    expect(state.inserts).toEqual([]);
    expect(state.updates).toHaveLength(1);
    expect(Object.keys(state.updates[0]).sort()).toEqual(
      ["pendingForkExpiresAt", "pendingForkKeyEnc", "pendingForkSelector", "updatedAt"].sort()
    );
    expect(state.row?.status).toBe("active");
    expect(decryptSecret(state.row?.accessTokenEnc as string)).toBe("A-old");
  });
});

describe("ProtonConnectionService.checkConnect", () => {
  it("checkConnect returns pending while the fork answers 422 and polls exactly once per call", async () => {
    const expiresAt = new Date(NOW.getTime() + 60_000);
    const { db, state } = fakeDb(
      pending(activeRow({ status: "pending", uidEnc: null }), "sel-1", expiresAt)
    );
    const d = deps(state, {
      pollFork: vi.fn(async () => ({ status: "pending" }) as ForkPollResult),
    });
    const svc = new ProtonConnectionService(db, d);

    expect(await svc.checkConnect("u")).toEqual({
      status: "pending",
      expiresAt: expiresAt.toISOString(),
    });
    expect(d.pollFork).toHaveBeenCalledTimes(1);
    expect(d.pollFork).toHaveBeenCalledWith("sel-1", KEY);
    await svc.checkConnect("u");
    expect(d.pollFork).toHaveBeenCalledTimes(2);
    expect(state.updates).toEqual([]);
  });

  it("completion activates, stores encrypted tokens + keyPassword, sets volume_id, clears pending_*", async () => {
    const { db, state } = fakeDb(
      pending(
        activeRow({
          status: "pending",
          uidEnc: null,
          accessTokenEnc: null,
          refreshTokenEnc: null,
          keyPasswordEnc: null,
          volumeId: null,
          eventCursor: null,
          timelineListedAt: null,
          backfillCompletedAt: null,
          lastSyncedAt: null,
        })
      )
    );
    const d = deps(state, { resolveVolumeId: vi.fn(async () => "vol-9") });

    expect(await new ProtonConnectionService(db, d).checkConnect("u")).toEqual({
      status: "active",
    });
    expect(d.resolveVolumeId).toHaveBeenCalledWith(newTokens, "KP-new");
    const row = state.row as ProtonConnection;
    expect(row.status).toBe("active");
    expect(decryptSecret(row.uidEnc as string)).toBe("U-new");
    expect(decryptSecret(row.accessTokenEnc as string)).toBe("A-new");
    expect(decryptSecret(row.refreshTokenEnc as string)).toBe("R-new");
    expect(decryptSecret(row.keyPasswordEnc as string)).toBe("KP-new");
    expect(row.volumeId).toBe("vol-9");
    expect(row.pendingForkSelector).toBeNull();
    expect(row.pendingForkKeyEnc).toBeNull();
    expect(row.pendingForkExpiresAt).toBeNull();
    expect(row.updatedAt).toEqual(NOW);
    expect(state.locks).toBe(1);
    expect(d.revoke).not.toHaveBeenCalled();
  });

  it("completion with the same volume keeps photos and nulls event_cursor, timeline_listed_at, backfill_completed_at", async () => {
    const { db, state } = fakeDb(pending(activeRow({ status: "needs_reauth", lastError: "x" })));
    const d = deps(state);

    expect(await new ProtonConnectionService(db, d).checkConnect("u")).toEqual({
      status: "active",
    });
    const row = state.row as ProtonConnection;
    expect(row.status).toBe("active");
    expect(row.eventCursor).toBeNull();
    expect(row.timelineListedAt).toBeNull();
    expect(row.backfillCompletedAt).toBeNull();
    expect(row.lastError).toBeNull();
    expect(decryptSecret(row.accessTokenEnc as string)).toBe("A-new");
    expect(state.deleted).toEqual([]);
    expect(state.photos).toBe(2);
    expect(state.blocks).toBe(1);
  });

  it("a same-volume reconnect with a new session revokes the superseded one and keeps photos", async () => {
    const { db, state } = fakeDb(pending(activeRow()));
    const d = deps(state);

    expect(await new ProtonConnectionService(db, d).checkConnect("u")).toEqual({
      status: "active",
    });
    // The old session can decrypt the whole account: it is signed out even on the same volume.
    expect(d.revoke).toHaveBeenCalledTimes(1);
    expect(d.revoke).toHaveBeenCalledWith({
      uid: "U-old",
      accessToken: "A-old",
      refreshToken: "R-old",
    });
    expect(state.deleted).toEqual([]);
    expect(state.photos).toBe(2);
    expect(state.blocks).toBe(1);
    expect(decryptSecret(state.row?.accessTokenEnc as string)).toBe("A-new");
  });

  it("a same-volume reconnect that lands the very session already stored revokes nothing", async () => {
    const { db, state } = fakeDb(pending(activeRow({ uidEnc: encryptSecret("U-new") })));
    const d = deps(state);

    expect(await new ProtonConnectionService(db, d).checkConnect("u")).toEqual({
      status: "active",
    });
    expect(d.revoke).not.toHaveBeenCalled();
  });

  it("completion with a different volume revokes the old session, deletes photos/blocks, and resets cursors", async () => {
    const { db, state } = fakeDb(pending(activeRow()));
    const d = deps(state, { resolveVolumeId: vi.fn(async () => "vol-other") });

    expect(await new ProtonConnectionService(db, d).checkConnect("u")).toEqual({
      status: "active",
    });
    expect(d.revoke).toHaveBeenCalledTimes(1);
    expect(d.revoke).toHaveBeenCalledWith({
      uid: "U-old",
      accessToken: "A-old",
      refreshToken: "R-old",
    });
    expect(state.photos).toBe(0);
    expect(state.blocks).toBe(0);
    const row = state.row as ProtonConnection;
    expect(row.volumeId).toBe("vol-other");
    expect(row.eventCursor).toBeNull();
    expect(row.timelineListedAt).toBeNull();
    expect(row.backfillCompletedAt).toBeNull();
    expect(row.lastSyncedAt).toBeNull();
    expect(decryptSecret(row.accessTokenEnc as string)).toBe("A-new");
  });

  it("an expired first-time fork deletes the row; an expired re-connect clears only pending_*", async () => {
    const expired = new Date(NOW.getTime() - 1);
    const first = fakeDb(pending(activeRow({ status: "pending", uidEnc: null }), "sel-1", expired));
    const d1 = deps(first.state);
    expect(await new ProtonConnectionService(first.db, d1).checkConnect("u")).toEqual({
      status: "expired",
    });
    expect(first.state.row).toBeNull();
    expect(d1.pollFork).not.toHaveBeenCalled();

    const again = fakeDb(pending(activeRow(), "sel-1", expired));
    const d2 = deps(again.state);
    expect(await new ProtonConnectionService(again.db, d2).checkConnect("u")).toEqual({
      status: "expired",
    });
    const row = again.state.row as ProtonConnection;
    expect(row.status).toBe("active");
    expect(row.pendingForkSelector).toBeNull();
    expect(row.pendingForkKeyEnc).toBeNull();
    expect(row.pendingForkExpiresAt).toBeNull();
    expect(decryptSecret(row.accessTokenEnc as string)).toBe("A-old");
    expect(again.state.deleted).toEqual([]);
    expect(d2.pollFork).not.toHaveBeenCalled();
  });

  it("a second concurrent completion after the first is a no-op (selector no longer matches under lock)", async () => {
    const { db, state } = fakeDb(
      pending(activeRow({ status: "pending", uidEnc: null, volumeId: null }))
    );
    const pollFork = vi.fn<ProtonConnectionDeps["pollFork"]>(async () => ({
      status: "ready",
      tokens: newTokens,
      keyPassword: "KP-new",
    }));
    const d = deps(state, { pollFork });
    const svc = new ProtonConnectionService(db, d);

    const results = await Promise.all([svc.checkConnect("u"), svc.checkConnect("u")]);
    expect(results).toEqual([{ status: "active" }, { status: "active" }]);
    expect(pollFork).toHaveBeenCalledTimes(2);
    expect(state.updates.filter((u) => u.status === "active")).toHaveLength(1);
    // The loser holds the very session the winner stored: it must not sign it out.
    expect(d.revoke).not.toHaveBeenCalled();
    expect(decryptSecret(state.row?.accessTokenEnc as string)).toBe("A-new");
  });

  it("signs out a losing completion that holds a different session", async () => {
    const { db, state } = fakeDb(
      pending(activeRow({ status: "pending", uidEnc: null, volumeId: null }))
    );
    const stray = { uid: "U-stray", accessToken: "A-stray", refreshToken: "R-stray" };
    const d = deps(state, {
      pollFork: vi.fn(
        async () => ({ status: "ready", tokens: stray, keyPassword: "KP" }) as ForkPollResult
      ),
      // Another writer completes (or restarts) the fork while this one resolves the volume.
      resolveVolumeId: vi.fn(async () => {
        state.row = { ...activeRow({ uidEnc: encryptSecret("U-win") }) };
        return "vol-1";
      }),
    });

    expect(await new ProtonConnectionService(db, d).checkConnect("u")).toEqual({
      status: "active",
    });
    expect(state.updates).toEqual([]);
    expect(d.revoke).toHaveBeenCalledWith(stray);
  });

  it("revokes the fresh session and clears the fork when the volume cannot be resolved", async () => {
    const { db, state } = fakeDb(
      pending(activeRow({ status: "pending", uidEnc: null, volumeId: null }))
    );
    const d = deps(state, {
      resolveVolumeId: vi.fn(async () => {
        throw new Error("Proton said something private");
      }),
    });

    await expect(new ProtonConnectionService(db, d).checkConnect("u")).rejects.toThrow();
    expect(d.revoke).toHaveBeenCalledWith(newTokens);
    expect(state.row).toBeNull();
  });

  it("revokes the fresh session when a concurrent disconnect removed the row before the volume failed", async () => {
    const { db, state } = fakeDb(pending(activeRow()));
    const d = deps(state, {
      resolveVolumeId: vi.fn(async () => {
        state.row = null; // disconnect landed meanwhile
        throw new Error("volume lookup failed");
      }),
    });

    await expect(new ProtonConnectionService(db, d).checkConnect("u")).rejects.toThrow();
    expect(d.revoke).toHaveBeenCalledTimes(1);
    expect(d.revoke).toHaveBeenCalledWith(newTokens);
  });

  it("revokes the fresh session when the fork was restarted before the volume failed", async () => {
    const { db, state } = fakeDb(pending(activeRow()));
    const d = deps(state, {
      resolveVolumeId: vi.fn(async () => {
        state.row = pending(activeRow(), "sel-2"); // a new fork replaced ours
        throw new Error("volume lookup failed");
      }),
    });

    await expect(new ProtonConnectionService(db, d).checkConnect("u")).rejects.toThrow();
    expect(d.revoke).toHaveBeenCalledWith(newTokens);
    // The restarted fork is not ours to clear.
    expect(state.row?.pendingForkSelector).toBe("sel-2");
  });

  it("does not revoke on a failed volume lookup when the row already holds this very session", async () => {
    const { db, state } = fakeDb(pending(activeRow()));
    const d = deps(state, {
      resolveVolumeId: vi.fn(async () => {
        state.row = activeRow({ uidEnc: encryptSecret("U-new") });
        throw new Error("volume lookup failed");
      }),
    });

    await expect(new ProtonConnectionService(db, d).checkConnect("u")).rejects.toThrow();
    expect(d.revoke).not.toHaveBeenCalled();
  });

  it("stale completion: an unreadable stored session counts as different, so the stray is revoked", async () => {
    const { db, state } = fakeDb(
      pending(activeRow({ status: "pending", uidEnc: null, volumeId: null }))
    );
    const d = deps(state, {
      resolveVolumeId: vi.fn(async () => {
        state.row = activeRow({ uidEnc: "not-a-valid-ciphertext" });
        return "vol-1";
      }),
    });

    expect(await new ProtonConnectionService(db, d).checkConnect("u")).toEqual({
      status: "active",
    });
    expect(state.updates).toEqual([]);
    expect(d.revoke).toHaveBeenCalledWith(newTokens);
  });
});

describe("ProtonConnectionService.disconnect", () => {
  it("disconnect deletes the row and photos even when revoke fails, returning revoked:false", async () => {
    const { db, state } = fakeDb(activeRow());
    const d = deps(state, { revoke: vi.fn(async () => false) });

    expect(await new ProtonConnectionService(db, d).disconnect("u")).toEqual({ revoked: false });
    expect(d.revoke).toHaveBeenCalledWith({
      uid: "U-old",
      accessToken: "A-old",
      refreshToken: "R-old",
    });
    expect(state.row).toBeNull();
    expect(state.photos).toBe(0);
    expect(state.blocks).toBe(0);
    expect(new Set(state.deleted)).toEqual(
      new Set(["proton_connections", "photos", "photo_blocks"])
    );
  });

  it("treats a connection without a session as nothing to revoke", async () => {
    const { db, state } = fakeDb(
      pending(activeRow({ status: "pending", uidEnc: null, accessTokenEnc: null }))
    );
    const d = deps(state);
    expect(await new ProtonConnectionService(db, d).disconnect("u")).toEqual({ revoked: true });
    expect(d.revoke).not.toHaveBeenCalled();
    expect(state.row).toBeNull();
  });

  it("revokeOnly signs out without deleting anything", async () => {
    const { db, state } = fakeDb(activeRow());
    const d = deps(state, { revoke: vi.fn(async () => false) });
    expect(await new ProtonConnectionService(db, d).revokeOnly("u")).toBe(false);
    expect(state.deleted).toEqual([]);
    expect(state.row).not.toBeNull();
  });
});
