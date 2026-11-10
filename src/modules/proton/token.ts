/**
 * Proton session refresh under a per-user advisory lock.
 *
 * Proton refresh tokens are single-use, so two processes (cron sync and a web
 * connect/disconnect) refreshing the same session must never both POST: the
 * loser would present an already-rotated refresh token, get a 4xx, and wrongly
 * flag the connection. The lock covers the re-read, the POST and the write, so
 * exactly one POST happens per rejected access token.
 */

import { eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { protonConnections } from "@/db/schema";
import type { SessionInfo } from "@/lib/adapters/proton/account";
import {
  type ProtonSessionTokens,
  postProtonRefresh,
  type RefreshHttpResult,
} from "@/lib/adapters/proton/http";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { PROTON_ERRORS } from "./types";

type Executor = Pick<Database, "execute">;

/** Per-user transaction-scoped lock shared by every Proton token writer. */
export async function lockProtonTokens(tx: Executor, userId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`proton-token:${userId}`}, 0))`
  );
}

/**
 * Host refresher for `ApiClient`'s `refreshSession` option. Returns the session
 * to use, or null when there is none. Never throws: an unexpected error is
 * logged and treated as transient, and only a confirmed rejection of the
 * still-current refresh token flips `needs_reauth`.
 */
export async function refreshProtonSession(
  db: Database,
  userId: string,
  rejectedAccessToken: string | undefined,
  post: (t: ProtonSessionTokens) => Promise<RefreshHttpResult> = postProtonRefresh
): Promise<SessionInfo | null> {
  try {
    return await db.transaction(async (tx) => {
      await lockProtonTokens(tx, userId);
      const row = (
        await tx
          .select()
          .from(protonConnections)
          .where(eq(protonConnections.userId, userId))
          .limit(1)
      )[0];
      if (!row?.uidEnc || !row.accessTokenEnc || !row.refreshTokenEnc) return null;
      // A flagged session stays flagged until the user reconnects.
      if (row.status === "needs_reauth") return null;

      const stored: ProtonSessionTokens = {
        uid: decryptSecret(row.uidEnc),
        accessToken: decryptSecret(row.accessTokenEnc),
        refreshToken: decryptSecret(row.refreshTokenEnc),
      };
      // Another writer already rotated past the rejected token: use theirs.
      if (stored.accessToken !== rejectedAccessToken) return stored;

      const result = await post(stored);
      switch (result.kind) {
        case "ok": {
          const next: ProtonSessionTokens = {
            uid: result.uid,
            accessToken: result.accessToken,
            refreshToken: result.refreshToken ?? stored.refreshToken,
          };
          await tx
            .update(protonConnections)
            .set({
              uidEnc: encryptSecret(next.uid),
              accessTokenEnc: encryptSecret(next.accessToken),
              refreshTokenEnc: encryptSecret(next.refreshToken),
              status: "active",
              updatedAt: new Date(),
            })
            .where(eq(protonConnections.userId, userId));
          return next;
        }
        case "rejected":
          await tx
            .update(protonConnections)
            .set({
              status: "needs_reauth",
              lastError: PROTON_ERRORS.authExpired,
              updatedAt: new Date(),
            })
            .where(eq(protonConnections.userId, userId));
          logger.warn("[Proton] refresh token rejected; connection needs reauth", {
            userId,
            status: result.status,
          });
          return null;
        case "rate_limited":
        case "transient":
          return null;
      }
    });
  } catch (error) {
    logger.error("[Proton] session refresh failed", {
      userId,
      error: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}
