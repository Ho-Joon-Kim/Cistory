import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import type { ProtonConnection } from "@/db/schema";
import type { ProtonSessionTokens, RefreshHttpResult } from "@/lib/adapters/proton/http";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { refreshProtonSession } from "./token";
import { PROTON_ERRORS } from "./types";

function row(
  tokens: { uid?: string; access?: string; refresh?: string } = {},
  over: Partial<ProtonConnection> = {}
): ProtonConnection {
  return {
    id: "c",
    userId: "u",
    uidEnc: encryptSecret(tokens.uid ?? "U1"),
    accessTokenEnc: encryptSecret(tokens.access ?? "old"),
    refreshTokenEnc: encryptSecret(tokens.refresh ?? "R1"),
    keyPasswordEnc: encryptSecret("kp"),
    status: "active",
    pendingForkSelector: null,
    pendingForkKeyEnc: null,
    pendingForkExpiresAt: null,
    volumeId: "v",
    eventCursor: null,
    timelineListedAt: null,
    backfillCompletedAt: null,
    lastSyncedAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

/** Stateful fake: an update mutates the stored row, so a later call re-reads it. */
function fakeDb(initial: ProtonConnection | null) {
  let current = initial;
  const updates: Record<string, unknown>[] = [];
  const executed: string[] = [];
  const db = {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => (current ? [current] : []) }) }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        updates.push(v);
        if (current) current = { ...current, ...v } as ProtonConnection;
        return { where: async () => undefined };
      },
    }),
    execute: async (query: { queryChunks: unknown[] }) => {
      executed.push(JSON.stringify(query.queryChunks));
      return undefined;
    },
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  return { db: db as unknown as Database, updates, executed };
}

type Post = (t: ProtonSessionTokens) => Promise<RefreshHttpResult>;

describe("refreshProtonSession", () => {
  it("skips the POST when another writer already rotated the token", async () => {
    const { db, updates } = fakeDb(row({ access: "new-by-other" }));
    const post = vi.fn<Post>();
    expect(await refreshProtonSession(db, "u", "old", post)).toMatchObject({
      uid: "U1",
      accessToken: "new-by-other",
      refreshToken: "R1",
    });
    expect(post).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("persists rotated tokens encrypted and keeps the stored refresh token when omitted", async () => {
    const { db, updates } = fakeDb(row());
    const post = vi.fn<Post>().mockResolvedValue({ kind: "ok", uid: "U", accessToken: "A2" });
    expect(await refreshProtonSession(db, "u", "old", post)).toEqual({
      uid: "U",
      accessToken: "A2",
      refreshToken: "R1",
    });
    expect(post).toHaveBeenCalledWith({ uid: "U1", accessToken: "old", refreshToken: "R1" });
    expect(updates).toHaveLength(1);
    expect(decryptSecret(updates[0].uidEnc as string)).toBe("U");
    expect(decryptSecret(updates[0].accessTokenEnc as string)).toBe("A2");
    expect(decryptSecret(updates[0].refreshTokenEnc as string)).toBe("R1");
    expect(updates[0].status).toBe("active");
    expect(updates[0].updatedAt).toBeInstanceOf(Date);
  });

  it("persists a rotated refresh token when the response carries one", async () => {
    const { db, updates } = fakeDb(row());
    const post = vi
      .fn<Post>()
      .mockResolvedValue({ kind: "ok", uid: "U1", accessToken: "A2", refreshToken: "R2" });
    expect(await refreshProtonSession(db, "u", "old", post)).toMatchObject({ refreshToken: "R2" });
    expect(decryptSecret(updates[0].refreshTokenEnc as string)).toBe("R2");
  });

  it("flips needs_reauth only when the locked re-read still equals the rejected token and the POST is a non-429 4xx", async () => {
    const { db, updates } = fakeDb(row());
    const post = vi.fn<Post>().mockResolvedValue({ kind: "rejected", status: 400 });
    expect(await refreshProtonSession(db, "u", "old", post)).toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([
      { status: "needs_reauth", lastError: PROTON_ERRORS.authExpired, updatedAt: expect.any(Date) },
    ]);
  });

  it("retries with the newer token instead of needs_reauth when a concurrent writer won", async () => {
    // Sequential stand-in for the race (C14a): the first caller rotates "old" under
    // the lock; the second caller, also holding the rejected "old", re-reads the
    // rotated row and returns it — no second POST, so the now-dead refresh token
    // can never come back as a 4xx that flips needs_reauth.
    const { db, updates } = fakeDb(row());
    const post = vi
      .fn<Post>()
      .mockResolvedValueOnce({ kind: "ok", uid: "U1", accessToken: "A2", refreshToken: "R2" })
      .mockResolvedValue({ kind: "rejected", status: 400 });

    const first = await refreshProtonSession(db, "u", "old", post);
    const second = await refreshProtonSession(db, "u", "old", post);

    expect(first).toEqual({ uid: "U1", accessToken: "A2", refreshToken: "R2" });
    expect(second).toEqual({ uid: "U1", accessToken: "A2", refreshToken: "R2" });
    expect(post).toHaveBeenCalledTimes(1);
    expect(updates.filter((u) => u.status === "needs_reauth")).toEqual([]);
  });

  it.each([{ kind: "rate_limited" } as const, { kind: "transient" } as const])(
    "never flips needs_reauth on $kind",
    async (result) => {
      const { db, updates } = fakeDb(row());
      const post = vi.fn<Post>().mockResolvedValue(result);
      expect(await refreshProtonSession(db, "u", "old", post)).toBeNull();
      expect(post).toHaveBeenCalledTimes(1);
      expect(updates).toEqual([]);
    }
  );

  it("returns null instead of throwing when the POST or DB throws", async () => {
    const { db, updates } = fakeDb(row());
    const post = vi.fn<Post>().mockRejectedValue(new Error("boom"));
    expect(await refreshProtonSession(db, "u", "old", post)).toBeNull();
    expect(updates).toEqual([]);

    const broken = {
      transaction: async () => {
        throw new Error("connection refused");
      },
    } as unknown as Database;
    expect(await refreshProtonSession(broken, "u", "old", post)).toBeNull();
  });

  it("returns null without a POST when the connection is missing, tokenless or flagged", async () => {
    const post = vi.fn<Post>();
    expect(await refreshProtonSession(fakeDb(null).db, "u", "old", post)).toBeNull();
    const pending = row({}, { uidEnc: null, accessTokenEnc: null, refreshTokenEnc: null });
    expect(await refreshProtonSession(fakeDb(pending).db, "u", "old", post)).toBeNull();
    const flagged = row({}, { status: "needs_reauth" });
    expect(await refreshProtonSession(fakeDb(flagged).db, "u", "old", post)).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it("takes the proton-token advisory lock inside the transaction", async () => {
    const { db, executed } = fakeDb(row({ access: "new-by-other" }));
    await refreshProtonSession(db, "u", "old", vi.fn<Post>());
    expect(executed).toHaveLength(1);
    expect(executed[0]).toContain("pg_advisory_xact_lock(hashtextextended(");
    expect(executed[0]).toContain("proton-token:u");
  });
});
