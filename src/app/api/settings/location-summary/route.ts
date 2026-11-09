/**
 * GET /api/settings/location-summary — the live status line under settings'
 * "위치 처리" row and the "장소 이름 없는 방문" todo. Cheap counts only: the full
 * per-day dry run stays behind GET /api/settings/location-backfill.
 */

import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { withAuth } from "@/lib/api-handler";
import { toKstCalendarDate } from "@/lib/date-key";
import type { LocationSummary } from "@/modules/settings/types";

export const GET = withAuth(async ({ user }) => {
  const db = getDb();
  const today = toKstCalendarDate(new Date());
  const [days, anomalies, unnamed] = await Promise.all([
    db.execute<{ processed: number; failed: number }>(sql`
      SELECT count(*) FILTER (WHERE status = 'completed')::int AS processed,
        count(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM location_processing_days WHERE user_id = ${user.id} AND date < ${today}`),
    db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM location_points
      WHERE user_id = ${user.id} AND anomaly = true`),
    db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM visits
      WHERE user_id = ${user.id} AND coalesce(place_name, '') = '' AND saved_place_id IS NULL`),
  ]);
  const summary: LocationSummary = {
    processedDays: Number(days.rows[0]?.processed ?? 0),
    failedDays: Number(days.rows[0]?.failed ?? 0),
    anomalies: Number(anomalies.rows[0]?.count ?? 0),
    unnamedVisits: Number(unnamed.rows[0]?.count ?? 0),
  };
  return NextResponse.json(summary, { headers: { "Cache-Control": "private, no-store" } });
});
