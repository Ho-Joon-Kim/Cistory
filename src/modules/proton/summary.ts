import { and, count, eq, gte, isNull, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { photoBlocks, photos, protonConnections } from "@/db/schema";
import { photoIsExposed } from "./repository";
import { PROTON_MAX_DETAILS_ATTEMPTS } from "./types";

export interface ProtonSummary {
  connected: boolean;
  status: "pending" | "active" | "needs_reauth" | null;
  photoCount: number;
  lastSyncedAt: string | null;
  backfilling: boolean;
  detailsFailedCount: number;
  blockedCount: number;
  lastError: string | null;
}

export async function getProtonSummary(db: Database, userId: string): Promise<ProtonSummary> {
  const detailsFailed = and(
    gte(photos.detailsAttempts, PROTON_MAX_DETAILS_ATTEMPTS),
    isNull(photos.detailsSyncedAt),
    isNull(photos.deletedAt)
  );
  // Sequential on purpose: callers may pass a single-client transaction.
  const [connection] = await db
    .select({
      status: protonConnections.status,
      lastSyncedAt: protonConnections.lastSyncedAt,
      backfillCompletedAt: protonConnections.backfillCompletedAt,
      lastError: protonConnections.lastError,
    })
    .from(protonConnections)
    .where(eq(protonConnections.userId, userId))
    .limit(1);
  const [photoCounts] = await db
    .select({
      exposed: sql<number>`count(*) filter (where ${photoIsExposed()})::int`,
      detailsFailed: sql<number>`count(*) filter (where ${detailsFailed})::int`,
    })
    .from(photos)
    .where(eq(photos.userId, userId));
  const [blocks] = await db
    .select({ value: count() })
    .from(photoBlocks)
    .where(eq(photoBlocks.userId, userId));

  const connected = connection !== undefined && connection.status !== "pending";
  return {
    connected,
    status: connection?.status ?? null,
    photoCount: Number(photoCounts?.exposed ?? 0),
    lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null,
    backfilling: connected && connection.backfillCompletedAt === null,
    detailsFailedCount: Number(photoCounts?.detailsFailed ?? 0),
    blockedCount: Number(blocks?.value ?? 0),
    lastError: connection?.lastError ?? null,
  };
}
