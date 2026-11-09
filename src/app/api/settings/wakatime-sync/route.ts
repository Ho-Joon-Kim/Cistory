/**
 * WakaTime Sync Management
 *
 * GET /api/settings/wakatime-sync - Get sync stats
 * POST /api/settings/wakatime-sync - Trigger manual sync
 */

import { count, eq, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { codingDailyStats, codingSessions, commits, users } from "@/db/schema";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { createWakaTimeSyncServiceForUser } from "@/modules/wakatime/service";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const db = getDb();

    const [sessionCount, dayCount, userRow, unsyncedCount] = await Promise.all([
      // Total coding sessions
      db.select({ count: count() }).from(codingSessions).where(eq(codingSessions.userId, user.id)),

      // Total days with stats
      db
        .select({ count: count() })
        .from(codingDailyStats)
        .where(eq(codingDailyStats.userId, user.id)),

      // User's last synced at
      db
        .select({ wakatimeLastSyncedAt: users.wakatimeLastSyncedAt })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1),

      // Commit dates not in coding_daily_stats
      db.execute<{ count: string }>(sql`
        SELECT COUNT(DISTINCT date(${commits.committedAt})) as count
        FROM ${commits}
        WHERE ${commits.userId} = ${user.id}
          AND date(${commits.committedAt})::text NOT IN (
            SELECT ${codingDailyStats.date}
            FROM ${codingDailyStats}
            WHERE ${codingDailyStats.userId} = ${user.id}
          )
      `),
    ]);

    return NextResponse.json({
      totalSessions: sessionCount[0]?.count ?? 0,
      totalDays: dayCount[0]?.count ?? 0,
      lastSyncedAt: userRow[0]?.wakatimeLastSyncedAt?.toISOString() ?? null,
      unsyncedDays: Number(unsyncedCount.rows[0]?.count ?? 0),
    });
  } catch (error) {
    logger.error("WakaTime sync stats error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "동기화 현황을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const body = (await request.json()) as { mode?: string };
    const mode = body.mode || "regular";

    const db = getDb();

    const service = await createWakaTimeSyncServiceForUser(db, user.id);
    if (!service) {
      return NextResponse.json(
        { error: "WakaTime 계정이 연결되지 않았습니다. 설정에서 WakaTime을 다시 연결해 주세요." },
        { status: 400 }
      );
    }

    if (mode === "initial") {
      const result = await service.syncAllCommitDates(user.id);
      return NextResponse.json({
        success: true,
        ...result,
      });
    }

    // regular mode
    const result = await service.syncUser(user.id);
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error("WakaTime sync error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "WakaTime을 동기화하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
