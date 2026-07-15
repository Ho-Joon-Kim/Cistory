import { and, eq, gte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { codingDailyStats, getDb, healthDailySummaries, visits } from "@/db";
import { localDaySql } from "@/db/sql";
import { withAuth } from "@/lib/api-handler";
import type { ActivityCorrelationDay } from "@/modules/health/types";

const WINDOW_DAYS = 14;

const KST_DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/** KST calendar day 'YYYY-MM-DD' of a UTC instant. */
function kstDay(d: Date): string {
  return KST_DAY_FMT.format(d);
}

/**
 * 건강 × 활동 교차 — the last {@link WINDOW_DAYS} KST days of step totals, distinct
 * places visited, and coding minutes, aligned on one day axis. Steps come from the
 * precomputed health rollups, visits from the location pipeline, coding from
 * WakaTime daily stats; each is bucketed to the same KST day space so the /health
 * correlation card can overlay them.
 */
export const GET = withAuth(async ({ user }) => {
  const db = getDb();

  const days: string[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    days.push(kstDay(new Date(Date.now() - i * 24 * 60 * 60 * 1000)));
  }
  const from = days[0];
  // KST midnight of the first day, expressed as the UTC instant to filter on.
  const lowerBound = new Date(`${from}T00:00:00+09:00`);

  // Steps — health_daily_summaries.day is already a KST 'YYYY-MM-DD' text key.
  const stepRows = await db
    .select({ day: healthDailySummaries.day, sum: healthDailySummaries.valueSum })
    .from(healthDailySummaries)
    .where(
      and(
        eq(healthDailySummaries.userId, user.id),
        eq(healthDailySummaries.metric, "steps"),
        gte(healthDailySummaries.day, from)
      )
    );
  const stepsByDay = new Map(stepRows.map((r) => [r.day, r.sum]));

  // Coding — coding_daily_stats.date is a KST calendar date column.
  const codeRows = await db
    .select({ date: codingDailyStats.date, secs: codingDailyStats.totalSeconds })
    .from(codingDailyStats)
    .where(and(eq(codingDailyStats.userId, user.id), gte(codingDailyStats.date, from)));
  const codingSecByDay = new Map(codeRows.map((r) => [String(r.date).slice(0, 10), r.secs]));

  // Visits — timestamps are UTC wall time; bucket to KST day and count.
  const dayExpr = localDaySql(visits.startTime);
  const visitRows = await db
    .select({ day: dayExpr, count: sql<number>`count(*)::int` })
    .from(visits)
    .where(and(eq(visits.userId, user.id), gte(visits.startTime, lowerBound)))
    .groupBy(dayExpr);
  const visitsByDay = new Map(visitRows.map((r) => [String(r.day).slice(0, 10), Number(r.count)]));

  const result: ActivityCorrelationDay[] = days.map((day) => {
    const steps = stepsByDay.get(day);
    const codingSec = codingSecByDay.get(day);
    return {
      day,
      steps: steps == null ? null : Math.round(Number(steps)),
      visits: visitsByDay.get(day) ?? 0,
      codingMin: codingSec == null ? null : Math.round(Number(codingSec) / 60),
    };
  });

  return NextResponse.json({ days: result });
});
