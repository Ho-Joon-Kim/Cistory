/**
 * WakaTime OAuth connection lifecycle: token freshness, refresh under a per-user
 * advisory lock, confirmed-failure → needs_reauth, and disconnect.
 *
 * Mirrors HealthSyncService.getValidToken (Google Health). Differences:
 *  - WakaTime code-flow tokens "expire after 100 years", so a missing expiry is
 *    treated as fresh (refresh then only happens reactively, after a 401).
 *  - Refresh-token rotation is undocumented: the adapter returns the new token if
 *    the response carries one, otherwise preserves the stored one.
 */

import { eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { type WakaTimeConnection, wakatimeConnections } from "@/db/schema";
import {
  createWakaTimeAdapter,
  createWakaTimeOAuthClient,
  WakaTimeAuthError,
  type WakaTimeDailySummary,
  type WakaTimeDataSource,
  type WakaTimeDuration,
  type WakaTimeOAuthClient,
} from "@/lib/adapters/wakatime/wakatime";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { wakatimeCallbackUrlFromEnv } from "@/lib/wakatime-urls";

const REFRESH_GRACE_MS = 60_000;

/** Fresh = no known expiry (100-year code-flow tokens) or comfortably before it. */
export function isWakaTimeTokenFresh(
  expiresAt: Date | null,
  now: number,
  graceMs = REFRESH_GRACE_MS
): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - graceMs > now;
}

function decryptOrNull(enc: string): string | null {
  try {
    return decryptSecret(enc);
  } catch {
    return null;
  }
}

export class WakaTimeConnectionService {
  constructor(
    private readonly db: Database,
    private readonly oauthFactory: () => WakaTimeOAuthClient = defaultOAuthClient
  ) {}

  async getConnection(userId: string): Promise<WakaTimeConnection | null> {
    const rows = await this.db
      .select()
      .from(wakatimeConnections)
      .where(eq(wakatimeConnections.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  async getActiveConnection(userId: string): Promise<WakaTimeConnection | null> {
    const connection = await this.getConnection(userId);
    return connection?.status === "active" ? connection : null;
  }

  async markNeedsReauth(userId: string, message: string): Promise<void> {
    await this.db
      .update(wakatimeConnections)
      .set({ status: "needs_reauth", lastSyncError: message, updatedAt: new Date() })
      .where(eq(wakatimeConnections.userId, userId));
  }

  /**
   * Disconnect: best-effort revoke, then hard-delete the connection row so no
   * decryptable live token survives. Coding history is retained. The row is
   * deleted REGARDLESS of whether revoke succeeds.
   */
  async disconnect(userId: string): Promise<void> {
    const connection = await this.getConnection(userId);
    if (connection) {
      // The revoke endpoint takes "the token (access or refresh) to be invalidated";
      // revoke both so neither outlives the disconnect.
      for (const enc of [connection.accessTokenEnc, connection.refreshTokenEnc]) {
        try {
          await this.oauthFactory().revokeToken(decryptSecret(enc));
        } catch (e) {
          logger.warn("[WakaTime] token revoke failed during disconnect (deleting anyway)", {
            userId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
    await this.db.delete(wakatimeConnections).where(eq(wakatimeConnections.userId, userId));
  }

  /**
   * Return a valid access token, refreshing under a per-user advisory lock when
   * needed. Pass `forceIfEquals` (a token that just 401'd) to force a refresh
   * unless another writer already replaced it.
   */
  async getValidToken(connection: WakaTimeConnection, forceIfEquals?: string): Promise<string> {
    const cached = decryptOrNull(connection.accessTokenEnc);
    if (
      cached &&
      cached !== forceIfEquals &&
      isWakaTimeTokenFresh(connection.accessTokenExpiresAt, Date.now())
    ) {
      return cached;
    }

    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`wakatime-token:${connection.userId}`}, 0))`
        );
        const fresh = (
          await tx
            .select()
            .from(wakatimeConnections)
            .where(eq(wakatimeConnections.userId, connection.userId))
            .limit(1)
        )[0];
        if (!fresh) {
          throw new Error(
            `WakaTime connection for ${connection.userId} disappeared during refresh`
          );
        }
        const freshToken = decryptOrNull(fresh.accessTokenEnc);
        if (
          freshToken &&
          freshToken !== forceIfEquals &&
          isWakaTimeTokenFresh(fresh.accessTokenExpiresAt, Date.now())
        ) {
          return freshToken;
        }

        const redirectUri = wakatimeCallbackUrlFromEnv();
        if (!redirectUri)
          throw new Error("NEXT_PUBLIC_APP_URL is not set; cannot refresh WakaTime");
        const tokens = await this.oauthFactory().refreshToken({
          refreshToken: decryptSecret(fresh.refreshTokenEnc),
          redirectUri,
        });

        await tx
          .update(wakatimeConnections)
          .set({
            accessTokenEnc: encryptSecret(tokens.accessToken),
            // Rotation-agnostic: the adapter returns the preserved token when omitted.
            refreshTokenEnc: encryptSecret(tokens.refreshToken),
            accessTokenExpiresAt: tokens.expiresAt,
            scope: tokens.scope ?? fresh.scope,
            wakatimeUserId: tokens.wakatimeUserId ?? fresh.wakatimeUserId,
            status: "active",
            updatedAt: new Date(),
          })
          .where(eq(wakatimeConnections.userId, connection.userId));
        return tokens.accessToken;
      });
    } catch (err) {
      // Only a CONFIRMED auth failure (invalid_grant on the refresh call itself)
      // flips needs_reauth. Transient network/5xx never does.
      if (err instanceof WakaTimeAuthError) {
        await this.markNeedsReauth(connection.userId, "WakaTime 인증이 만료되었습니다");
      }
      throw err;
    }
  }

  /**
   * Run one data read with the user's token. A 401 forces one refresh + retry; a
   * freshly refreshed token that still 401s is a confirmed re-link situation.
   */
  async withToken<T>(
    connection: WakaTimeConnection,
    call: (token: string) => Promise<T>
  ): Promise<T> {
    let token = await this.getValidToken(connection);
    try {
      return await call(token);
    } catch (err) {
      if (!(err instanceof WakaTimeAuthError)) throw err;
      token = await this.getValidToken(connection, token);
      try {
        return await call(token);
      } catch (retryErr) {
        if (retryErr instanceof WakaTimeAuthError) {
          await this.markNeedsReauth(connection.userId, "WakaTime 인증이 만료되었습니다");
        }
        throw retryErr;
      }
    }
  }

  /** A data source bound to one user's connection, refresh-aware per call. */
  dataSourceFor(connection: WakaTimeConnection): WakaTimeDataSource {
    return {
      getDurations: (date: string): Promise<WakaTimeDuration[]> =>
        this.withToken(connection, (t) => createWakaTimeAdapter(t).getDurations(date)),
      getSummaries: (start: string, end: string): Promise<WakaTimeDailySummary[]> =>
        this.withToken(connection, (t) => createWakaTimeAdapter(t).getSummaries(start, end)),
    };
  }
}

function defaultOAuthClient(): WakaTimeOAuthClient {
  const clientId = process.env.WAKATIME_CLIENT_ID;
  const clientSecret = process.env.WAKATIME_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("WAKATIME_CLIENT_ID / WAKATIME_CLIENT_SECRET are not set");
  }
  return createWakaTimeOAuthClient(clientId, clientSecret);
}

export function createWakaTimeConnectionService(db: Database): WakaTimeConnectionService {
  return new WakaTimeConnectionService(db);
}
