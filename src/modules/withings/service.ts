import { eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { bodyMeasurements, type WithingsConnection, withingsConnections } from "@/db/schema";
import {
  createWithingsAdapter,
  type ParsedMeasureGroup,
  type WithingsAdapter,
  WithingsAuthError,
} from "@/lib/adapters/withings/interface";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { logger } from "@/lib/logger";

const TOKEN_REFRESH_GRACE_MS = 60_000;

export interface WithingsSyncResult {
  userId: string;
  measurementsUpserted: number;
  skipped: boolean;
}

interface ServiceOptions {
  clientId?: string;
  clientSecret?: string;
  /** Forwarded to the adapter (e.g. throttleMs: 0 in tests). */
  adapterOptions?: { throttleMs?: number };
}

function decryptOrNull(stored: string | null): string | null {
  if (!stored) return null;
  try {
    return decryptSecret(stored);
  } catch {
    return null;
  }
}

/** Cached access token is usable if present and not within the refresh grace window. */
export function isTokenFresh(
  expiresAt: Date | null,
  now: number,
  graceMs = TOKEN_REFRESH_GRACE_MS
): boolean {
  return !!expiresAt && expiresAt.getTime() > now + graceMs;
}

function numOrNull(v: number | undefined): string | null {
  return v === undefined ? null : String(v);
}

function intOrNull(v: number | undefined): number | null {
  return v === undefined ? null : Math.round(v);
}

/**
 * Map a parsed measurement group into a body_measurements row. numeric columns
 * are serialized to strings (drizzle numeric contract); integer columns are
 * rounded. Absent metrics become null so an upsert fully replaces prior values.
 */
export function buildMeasurementValues(userId: string, group: ParsedMeasureGroup) {
  const m = group.metrics;
  return {
    userId,
    withingsGroupId: group.groupId,
    measuredAt: group.measuredAt,
    category: group.category,
    weightKg: numOrNull(m.weightKg),
    fatMassKg: numOrNull(m.fatMassKg),
    fatFreeMassKg: numOrNull(m.fatFreeMassKg),
    muscleMassKg: numOrNull(m.muscleMassKg),
    boneMassKg: numOrNull(m.boneMassKg),
    hydrationKg: numOrNull(m.hydrationKg),
    fatRatioPct: numOrNull(m.fatRatioPct),
    heartRateBpm: intOrNull(m.heartRateBpm),
    visceralFat: numOrNull(m.visceralFat),
    bmrKcal: numOrNull(m.bmrKcal),
    metabolicAge: intOrNull(m.metabolicAge),
    rawMeasures: JSON.stringify(group.raw),
  };
}

export class WithingsSyncService {
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly adapterOptions?: { throttleMs?: number };

  constructor(
    private db: Database,
    options: ServiceOptions = {}
  ) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.adapterOptions = options.adapterOptions;
  }

  private getAdapter(): WithingsAdapter {
    const clientId = this.clientId ?? process.env.WITHINGS_CLIENT_ID;
    const clientSecret = this.clientSecret ?? process.env.WITHINGS_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("WITHINGS_CLIENT_ID / WITHINGS_CLIENT_SECRET is not set");
    }
    return createWithingsAdapter(clientId, clientSecret, this.adapterOptions);
  }

  async getConnection(userId: string): Promise<WithingsConnection | null> {
    const rows = await this.db
      .select()
      .from(withingsConnections)
      .where(eq(withingsConnections.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  async disconnect(userId: string): Promise<void> {
    // Hard-delete so no decryptable live token survives the user's revocation.
    // Measurement history (body_measurements) is intentionally retained.
    await this.db.delete(withingsConnections).where(eq(withingsConnections.userId, userId));
  }

  private async markNeedsReauth(userId: string, message: string): Promise<void> {
    await this.db
      .update(withingsConnections)
      .set({ status: "needs_reauth", lastSyncError: message, updatedAt: new Date() })
      .where(eq(withingsConnections.userId, userId));
  }

  /**
   * Return a valid access token, refreshing under a per-user advisory lock when
   * needed. Withings refresh tokens rotate, so the new access AND refresh token
   * are persisted together inside the locked transaction. Pass `forceIfEquals`
   * (the token that just 401'd) to force a refresh unless another writer already
   * rotated to a different valid token.
   */
  async getValidToken(connection: WithingsConnection, forceIfEquals?: string): Promise<string> {
    const cached = decryptOrNull(connection.accessTokenEnc);
    if (
      cached &&
      cached !== forceIfEquals &&
      isTokenFresh(connection.accessTokenExpiresAt, Date.now())
    ) {
      return cached;
    }

    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`withings-token:${connection.userId}`}, 0))`
        );

        const fresh = (
          await tx
            .select()
            .from(withingsConnections)
            .where(eq(withingsConnections.userId, connection.userId))
            .limit(1)
        )[0];
        if (!fresh) {
          throw new Error(
            `Withings connection for ${connection.userId} disappeared during refresh`
          );
        }

        const freshToken = decryptOrNull(fresh.accessTokenEnc);
        if (
          freshToken &&
          freshToken !== forceIfEquals &&
          isTokenFresh(fresh.accessTokenExpiresAt, Date.now())
        ) {
          return freshToken;
        }

        const refreshToken = decryptSecret(fresh.refreshTokenEnc);
        const tokens = await this.getAdapter().refreshToken(refreshToken);

        await tx
          .update(withingsConnections)
          .set({
            accessTokenEnc: encryptSecret(tokens.accessToken),
            refreshTokenEnc: encryptSecret(tokens.refreshToken),
            accessTokenExpiresAt: tokens.expiresAt,
            scope: tokens.scope || fresh.scope,
            withingsUserId: tokens.withingsUserId || fresh.withingsUserId,
            status: "active",
            updatedAt: new Date(),
          })
          .where(eq(withingsConnections.userId, connection.userId));

        return tokens.accessToken;
      });
    } catch (err) {
      // Only a confirmed auth failure (not a transient network/5xx error) flips
      // the connection to needs_reauth so the settings UI can prompt re-linking.
      if (err instanceof WithingsAuthError) {
        await this.markNeedsReauth(connection.userId, err.message);
      }
      throw err;
    }
  }

  async syncUser(
    userId: string,
    opts: { skipIfSyncedWithinMs?: number } = {}
  ): Promise<WithingsSyncResult> {
    const connection = await this.getConnection(userId);
    if (!connection || connection.status !== "active") {
      return { userId, measurementsUpserted: 0, skipped: true };
    }
    if (
      opts.skipIfSyncedWithinMs &&
      connection.lastSyncedAt &&
      Date.now() - connection.lastSyncedAt.getTime() < opts.skipIfSyncedWithinMs
    ) {
      return { userId, measurementsUpserted: 0, skipped: true };
    }

    return this.runSync(connection, connection.lastMeasureUpdate == null);
  }

  /** Full historical backfill (from startdate=0). Idempotent via upsert. */
  async backfillUser(userId: string): Promise<WithingsSyncResult> {
    const connection = await this.getConnection(userId);
    if (!connection || connection.status !== "active") {
      return { userId, measurementsUpserted: 0, skipped: true };
    }
    return this.runSync(connection, true);
  }

  private async fetchGroups(
    connection: WithingsConnection,
    full: boolean
  ): Promise<{ groups: ParsedMeasureGroup[]; updatetime: number }> {
    const adapter = this.getAdapter();
    const fetchOpts = full
      ? { startdate: 0 as number }
      : { lastupdate: connection.lastMeasureUpdate };
    let token = await this.getValidToken(connection);
    try {
      return await adapter.getMeasurements({ accessToken: token, ...fetchOpts });
    } catch (err) {
      // A 401 from getmeas despite an un-expired stored token → force one refresh
      // and retry once before giving up.
      if (err instanceof WithingsAuthError) {
        token = await this.getValidToken(connection, token);
        try {
          return await adapter.getMeasurements({ accessToken: token, ...fetchOpts });
        } catch (retryErr) {
          // A brand-new token still failing auth is a confirmed re-link
          // situation (e.g. scope revoked Withings-side), not transient. Promote
          // so the settings UI shows the "다시 연동" prompt instead of silently
          // burning a refresh-token rotation every cron run.
          if (retryErr instanceof WithingsAuthError) {
            await this.markNeedsReauth(connection.userId, retryErr.message);
          }
          throw retryErr;
        }
      }
      throw err;
    }
  }

  private async runSync(
    connection: WithingsConnection,
    full: boolean
  ): Promise<WithingsSyncResult> {
    const userId = connection.userId;
    try {
      const { groups, updatetime } = await this.fetchGroups(connection, full);

      await this.db.transaction(async (tx) => {
        for (const group of groups) {
          const values = buildMeasurementValues(userId, group);
          const { userId: _u, withingsGroupId: _g, ...updatable } = values;
          await tx
            .insert(bodyMeasurements)
            .values(values)
            .onConflictDoUpdate({
              target: [bodyMeasurements.userId, bodyMeasurements.withingsGroupId],
              set: updatable,
            });
        }

        await tx
          .update(withingsConnections)
          .set({
            lastMeasureUpdate: updatetime || connection.lastMeasureUpdate,
            lastSyncedAt: new Date(),
            lastSyncError: null,
            updatedAt: new Date(),
          })
          .where(eq(withingsConnections.userId, userId));
      });

      logger.info("[Withings] Sync complete", {
        userId,
        full,
        measurements: groups.length,
        updatetime,
      });
      return { userId, measurementsUpserted: groups.length, skipped: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.db
        .update(withingsConnections)
        .set({ lastSyncError: message, updatedAt: new Date() })
        .where(eq(withingsConnections.userId, userId))
        .catch(() => undefined);
      logger.error("[Withings] Sync failed", { userId, error: message });
      throw err;
    }
  }
}

export function createWithingsSyncService(
  db: Database,
  options?: ServiceOptions
): WithingsSyncService {
  return new WithingsSyncService(db, options);
}
