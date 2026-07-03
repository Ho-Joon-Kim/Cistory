import { and, eq, gte, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { commits } from "@/db/schema";
import { localDaySql } from "@/db/sql";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { toLocalDateString } from "@/lib/utils";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;
    const db = getDb();

    // Get commits from the last 30 days grouped by date
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const localDay = localDaySql(commits.committedAt);
    const dailyStats = await db
      .select({
        date: sql<string>`to_char(${localDay}, 'YYYY-MM-DD')`.as("date"),
        count: sql<number>`COUNT(*)`.as("count"),
      })
      .from(commits)
      .where(and(eq(commits.userId, user.id), gte(commits.committedAt, thirtyDaysAgo)))
      .groupBy(localDay)
      .orderBy(localDay);

    // Fill in missing dates with 0 commits
    const result: { date: string; count: number }[] = [];
    const statsMap = new Map(dailyStats.map((s) => [s.date, Number(s.count)]));

    for (let i = 29; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = toLocalDateString(date);
      result.push({
        date: dateStr,
        count: statsMap.get(dateStr) ?? 0,
      });
    }

    const totalCommits = result.reduce((sum, d) => sum + d.count, 0);
    const maxCount = Math.max(...result.map((d) => d.count), 1);

    return NextResponse.json({
      stats: result,
      totalCommits,
      maxCount,
    });
  } catch (error) {
    console.error("Get daily stats error:", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
