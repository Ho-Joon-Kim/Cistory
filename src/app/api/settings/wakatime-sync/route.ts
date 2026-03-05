/**
 * WakaTime Sync Management
 *
 * GET /api/settings/wakatime-sync - Get sync stats
 * POST /api/settings/wakatime-sync - Trigger manual sync
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { getDb } from "@/db";
import { users, codingSessions, codingDailyStats, commits } from "@/db/schema";
import { eq, sql, count } from "drizzle-orm";
import { createWakaTimeSyncService } from "@/modules/wakatime/service";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const db = getDb();

    const [sessionCount, dayCount, userRow, unsyncedCount] = await Promise.all([
      // Total coding sessions
      db
        .select({ count: count() })
        .from(codingSessions)
        .where(eq(codingSessions.userId, user.id)),

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
    console.error("WakaTime sync stats error:", error);
    return NextResponse.json(
      { error: "동기화 현황 조회에 실패했습니다" },
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

    // Get user's WakaTime API key
    const userRow = await db
      .select({ wakatimeApiKey: users.wakatimeApiKey })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    const apiKey = userRow[0]?.wakatimeApiKey;
    if (!apiKey) {
      return NextResponse.json(
        { error: "WakaTime API 키가 설정되지 않았습니다" },
        { status: 400 }
      );
    }

    const service = createWakaTimeSyncService(db, apiKey);

    if (mode === "initial") {
      const result = await service.syncAllCommitDates(user.id);
      return NextResponse.json({
        success: true,
        ...result,
      });
    }

    // regular mode
    await service.syncUser(user.id);
    return NextResponse.json({
      success: true,
      syncedDays: 2,
      totalSessions: 0,
      totalSummaries: 0,
    });
  } catch (error) {
    console.error("WakaTime sync error:", error);
    return NextResponse.json(
      { error: "WakaTime 동기화에 실패했습니다" },
      { status: 500 }
    );
  }
}
