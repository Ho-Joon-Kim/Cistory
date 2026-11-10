/**
 * Proton connection lifecycle: start a session fork, poll it to completion,
 * expire it, and disconnect.
 *
 * Every Proton call (fork start/poll, volume lookup, revoke) happens outside the
 * `proton-token` advisory lock: anything that can 401 may refresh, and the
 * refresher takes that same lock in its own transaction. Network first, then
 * lock + re-read + write.
 */

import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { type ProtonConnection, photoBlocks, photos, protonConnections } from "@/db/schema";
import { createProtonPhotosClient } from "@/lib/adapters/proton/client";
import {
  type ProtonSessionTokens,
  pollProtonFork,
  startProtonFork,
} from "@/lib/adapters/proton/fork";
import { revokeProtonSession } from "@/lib/adapters/proton/http";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { DbSessionCredentials } from "./credentials";
import { lockProtonTokens } from "./token";

export type ConnectStatus =
  | { status: "none" }
  | { status: "pending"; expiresAt: string }
  | { status: "active" }
  | { status: "expired" };

export interface ProtonConnectionDeps {
  startFork: typeof startProtonFork;
  pollFork: typeof pollProtonFork;
  resolveVolumeId: (tokens: ProtonSessionTokens, keyPassword: string) => Promise<string>;
  revoke: typeof revokeProtonSession;
  now: () => Date;
}

/**
 * Looks up the Photos volume with a short-lived client over in-memory
 * credentials. The fresh tokens are not stored yet, so a refresh has nothing
 * valid to read back: the DB refresher would hand out the *previous* session.
 */
async function resolveVolumeIdInMemory(
  tokens: ProtonSessionTokens,
  keyPassword: string
): Promise<string> {
  const api = await createProtonPhotosClient({
    credentials: DbSessionCredentials.fromSession(tokens, keyPassword),
    refreshSession: async () => null,
  });
  return api.getPhotosVolumeId();
}

const CLEARED_FORK = {
  pendingForkSelector: null,
  pendingForkKeyEnc: null,
  pendingForkExpiresAt: null,
} as const;

function storedTokens(row: ProtonConnection | null | undefined): ProtonSessionTokens | null {
  if (!row?.uidEnc || !row.accessTokenEnc || !row.refreshTokenEnc) return null;
  return {
    uid: decryptSecret(row.uidEnc),
    accessToken: decryptSecret(row.accessTokenEnc),
    refreshToken: decryptSecret(row.refreshTokenEnc),
  };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

/** `storedTokens`, but an unreadable row (decrypt failure) is logged and read as no session. */
function readableTokens(row: ProtonConnection | null): ProtonSessionTokens | null {
  try {
    return storedTokens(row);
  } catch (error) {
    logger.warn("[Proton] stored session unreadable on connect", {
      userId: row?.userId,
      error: errorName(error),
    });
    return null;
  }
}

/**
 * Whether `row` holds the session `tokens` already. An unreadable row (decrypt
 * failure) counts as a different session, so the caller signs `tokens` out
 * rather than leave a stray session alive.
 */
function holdsSession(row: ProtonConnection | null, tokens: ProtonSessionTokens): boolean {
  return readableTokens(row)?.uid === tokens.uid;
}

export class ProtonConnectionService {
  private readonly deps: ProtonConnectionDeps;

  constructor(
    private readonly db: Database,
    deps: Partial<ProtonConnectionDeps> = {}
  ) {
    this.deps = {
      startFork: startProtonFork,
      pollFork: pollProtonFork,
      resolveVolumeId: resolveVolumeIdInMemory,
      revoke: revokeProtonSession,
      now: () => new Date(),
      ...deps,
    };
  }

  async getConnection(userId: string): Promise<ProtonConnection | null> {
    return this.readRow(this.db, userId);
  }

  private async readRow(
    executor: Pick<Database, "select">,
    userId: string
  ): Promise<ProtonConnection | null> {
    const rows = await executor
      .select()
      .from(protonConnections)
      .where(eq(protonConnections.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Begins a fork. A first connect inserts a `pending` row; a re-connect writes
   * only `pending_*`, so the working session survives until the new one lands.
   */
  async startConnect(userId: string): Promise<{ signInUrl: string; expiresAt: string }> {
    const fork = await this.deps.startFork();
    const now = this.deps.now();
    const pendingFork = {
      pendingForkSelector: fork.selector,
      pendingForkKeyEnc: encryptSecret(fork.encryptionKey.toString("base64")),
      pendingForkExpiresAt: fork.expiresAt,
    };

    await this.db.transaction(async (tx) => {
      await lockProtonTokens(tx, userId);
      const row = await this.readRow(tx, userId);
      if (row) {
        await tx
          .update(protonConnections)
          .set({ ...pendingFork, updatedAt: now })
          .where(eq(protonConnections.userId, userId));
      } else {
        await tx.insert(protonConnections).values({
          userId,
          status: "pending",
          ...pendingFork,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    return { signInUrl: fork.signInUrl, expiresAt: fork.expiresAt.toISOString() };
  }

  /** One fork poll per call; the client drives the interval. */
  async checkConnect(userId: string): Promise<ConnectStatus> {
    const row = await this.getConnection(userId);
    if (!row) return { status: "none" };
    if (!row.pendingForkSelector || !row.pendingForkKeyEnc || !row.pendingForkExpiresAt) {
      return this.statusOf(row);
    }
    if (row.pendingForkExpiresAt.getTime() <= this.deps.now().getTime()) {
      await this.clearExpiredFork(userId);
      return { status: "expired" };
    }

    const selector = row.pendingForkSelector;
    const key = Buffer.from(decryptSecret(row.pendingForkKeyEnc), "base64");
    const polled = await this.deps.pollFork(selector, key);
    if (polled.status === "pending") {
      return { status: "pending", expiresAt: row.pendingForkExpiresAt.toISOString() };
    }
    return this.complete(userId, selector, polled.tokens, polled.keyPassword);
  }

  private async complete(
    userId: string,
    selector: string,
    tokens: ProtonSessionTokens,
    keyPassword: string
  ): Promise<ConnectStatus> {
    let volumeId: string;
    try {
      volumeId = await this.deps.resolveVolumeId(tokens, keyPassword);
    } catch (error) {
      // The fork is consumed, so these tokens can never be stored: sign them out
      // rather than leave a session that can decrypt the whole account.
      logger.warn("[Proton] volume lookup failed on connect", { userId, error: errorName(error) });
      // Revoke unless the row already holds this very session: a concurrent
      // disconnect (row gone) or restarted fork leaves these tokens stored nowhere.
      const current = await this.dropFork(userId, selector);
      if (!holdsSession(current, tokens)) await this.deps.revoke(tokens);
      throw error;
    }

    const now = this.deps.now();
    const outcome = await this.db.transaction(async (tx) => {
      await lockProtonTokens(tx, userId);
      const row = await this.readRow(tx, userId);
      if (!row || row.pendingForkSelector !== selector) {
        return { kind: "stale" as const, current: row };
      }

      const previous = readableTokens(row);
      const switched = row.volumeId !== volumeId;
      if (switched) {
        // A different Proton account: none of the old library applies.
        await tx.delete(photos).where(eq(photos.userId, userId));
        await tx.delete(photoBlocks).where(eq(photoBlocks.userId, userId));
      }
      await tx
        .update(protonConnections)
        .set({
          uidEnc: encryptSecret(tokens.uid),
          accessTokenEnc: encryptSecret(tokens.accessToken),
          refreshTokenEnc: encryptSecret(tokens.refreshToken),
          keyPasswordEnc: encryptSecret(keyPassword),
          status: "active",
          volumeId,
          ...CLEARED_FORK,
          eventCursor: null,
          timelineListedAt: null,
          backfillCompletedAt: null,
          ...(switched && { lastSyncedAt: null }),
          lastError: null,
          updatedAt: now,
        })
        .where(eq(protonConnections.userId, userId));
      // Any superseded session is signed out, same volume or not: it can decrypt
      // the whole Proton account (Mail included), not just this volume.
      return {
        kind: "activated" as const,
        replaced: previous && previous.uid !== tokens.uid ? previous : null,
      };
    });

    if (outcome.kind === "stale") {
      // Another poll already completed (or restarted) this fork. Its session is
      // the one to keep; sign out ours only if it is a different session.
      if (!holdsSession(outcome.current, tokens)) await this.deps.revoke(tokens);
      return this.statusOf(outcome.current);
    }
    if (outcome.replaced) await this.deps.revoke(outcome.replaced);
    return { status: "active" };
  }

  /** Status as stored, without polling: a restarted fork reads as pending. */
  private statusOf(row: ProtonConnection | null): ConnectStatus {
    if (row?.pendingForkExpiresAt) {
      return { status: "pending", expiresAt: row.pendingForkExpiresAt.toISOString() };
    }
    return row?.status === "active" ? { status: "active" } : { status: "none" };
  }

  /**
   * Clears `selector` if it is still the pending fork. Returns the row as read
   * under the lock (null when a concurrent disconnect removed it), so the
   * caller can tell whether the row holds the session it is about to revoke.
   */
  private async dropFork(userId: string, selector: string): Promise<ProtonConnection | null> {
    return this.db.transaction(async (tx) => {
      await lockProtonTokens(tx, userId);
      const row = await this.readRow(tx, userId);
      if (row && row.pendingForkSelector === selector) await this.clearFork(tx, row);
      return row;
    });
  }

  private async clearFork(
    tx: Pick<Database, "update" | "delete">,
    row: ProtonConnection
  ): Promise<void> {
    if (row.status === "pending") {
      await tx.delete(protonConnections).where(eq(protonConnections.userId, row.userId));
      return;
    }
    await tx
      .update(protonConnections)
      .set({ ...CLEARED_FORK, updatedAt: this.deps.now() })
      .where(eq(protonConnections.userId, row.userId));
  }

  /**
   * Expires an elapsed fork: a first-time `pending` row is deleted, a
   * re-connect only loses its `pending_*` and keeps the working session.
   */
  async clearExpiredFork(userId: string): Promise<void> {
    const now = this.deps.now();
    await this.db.transaction(async (tx) => {
      await lockProtonTokens(tx, userId);
      const row = await this.readRow(tx, userId);
      if (!row?.pendingForkExpiresAt || row.pendingForkExpiresAt.getTime() > now.getTime()) return;
      await this.clearFork(tx, row);
    });
  }

  /**
   * Deletes the connection and the photo library, then best-effort signs the
   * session out. The tokens are read under the lock, so they are the latest a
   * concurrent refresh may have rotated to, and nothing can rotate them after.
   */
  async disconnect(userId: string): Promise<{ revoked: boolean }> {
    const row = await this.db.transaction(async (tx) => {
      await lockProtonTokens(tx, userId);
      const current = await this.readRow(tx, userId);
      await tx.delete(photos).where(eq(photos.userId, userId));
      await tx.delete(photoBlocks).where(eq(photoBlocks.userId, userId));
      await tx.delete(protonConnections).where(eq(protonConnections.userId, userId));
      return current;
    });
    return { revoked: await this.revokeRow(userId, row) };
  }

  /** Signs the session out without touching any rows (account deletion cascades). */
  async revokeOnly(userId: string): Promise<boolean> {
    return this.revokeRow(userId, await this.getConnection(userId));
  }

  private async revokeRow(userId: string, row: ProtonConnection | null): Promise<boolean> {
    let tokens: ProtonSessionTokens | null;
    try {
      tokens = storedTokens(row);
    } catch (error) {
      logger.warn("[Proton] stored session unreadable on revoke", {
        userId,
        error: errorName(error),
      });
      return false;
    }
    if (!tokens) return true;
    const revoked = await this.deps.revoke(tokens);
    if (!revoked) logger.warn("[Proton] session revoke not confirmed", { userId });
    return revoked;
  }
}
