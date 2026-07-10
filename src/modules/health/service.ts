import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { type HealthConnection, healthConnections } from "@/db/schema";
import {
  createGoogleHealthAdapter,
  type GoogleHealthAdapter,
} from "@/lib/adapters/google-health/interface";
import { decryptSecret } from "@/lib/crypto";
import { logger } from "@/lib/logger";

// NOTE: This is the U4 slice of HealthSyncService — connection lookup + disconnect,
// which are independent of the U1 live-spike findings. U5 extends this same class
// with getValidToken / syncUser / backfillPendingConnections once U1 confirms the
// metric set and value shapes.

interface ServiceOptions {
  clientId?: string;
  clientSecret?: string;
  /** Forwarded to the adapter (e.g. throttleMs: 0 in tests). */
  adapterOptions?: { throttleMs?: number };
}

export class HealthSyncService {
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

  private getAdapter(): GoogleHealthAdapter {
    const clientId = this.clientId ?? process.env.FITBIT_CLIENT_ID;
    const clientSecret = this.clientSecret ?? process.env.FITBIT_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("FITBIT_CLIENT_ID / FITBIT_CLIENT_SECRET is not set");
    }
    return createGoogleHealthAdapter(clientId, clientSecret, this.adapterOptions);
  }

  async getConnection(userId: string): Promise<HealthConnection | null> {
    const rows = await this.db
      .select()
      .from(healthConnections)
      .where(eq(healthConnections.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Disconnect: best-effort revoke of the Google grant, then hard-delete the
   * connection row so no decryptable live token survives. Sample/summary history
   * is intentionally retained. The row is deleted REGARDLESS of whether revoke
   * succeeds — a revoke failure (network, already-revoked) must never strand a
   * decryptable token in the DB.
   */
  async disconnect(userId: string): Promise<void> {
    const connection = await this.getConnection(userId);
    if (connection) {
      try {
        const refreshToken = decryptSecret(connection.refreshTokenEnc);
        await this.getAdapter().revokeToken(refreshToken);
      } catch (e) {
        logger.warn("[Health] token revoke failed during disconnect (deleting anyway)", {
          userId,
          error: String(e),
        });
      }
    }
    await this.db.delete(healthConnections).where(eq(healthConnections.userId, userId));
  }
}

export function createHealthSyncService(db: Database, options?: ServiceOptions): HealthSyncService {
  return new HealthSyncService(db, options);
}
