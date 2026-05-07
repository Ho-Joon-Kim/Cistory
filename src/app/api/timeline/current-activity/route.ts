/**
 * GET /api/timeline/current-activity
 *
 * Returns a hint about the user's most recent subway activity, intended for
 * "now riding 2호선" badge UX. Strategy:
 *   - Look up the most recent subway_trip_match where sub_end_time is within
 *     the last 60 min (configurable via ?windowMinutes=).
 *   - If found, return line + start/end station and how long ago it ended.
 *   - Otherwise return { active: false }.
 *
 * Note: the matcher runs daily at 01:00 KST, so this endpoint is only as fresh
 * as the last batch run. Real-time inference (running matcher on the fly over
 * the last 10 minutes of location_points each request) is future work — see
 * the plan's "Realtime hint (후속 PR)" section.
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb, subwayTripMatches } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { resolveLineColor } from "@/lib/subway-color";

interface CurrentActivityRow {
  match_id: string;
  sub_start_time: Date;
  sub_end_time: Date;
  total_confidence: number | string;
  line_id: string;
  line_ref: string | null;
  line_name: string | null;
  line_colour: string | null;
  line_network: string | null;
  fallback_idx: number | string;
  start_station_name: string | null;
  end_station_name: string | null;
}

const DEFAULT_WINDOW_MIN = 60;
const MAX_WINDOW_MIN = 720; // 12h cap so we don't accidentally return something stale

export async function GET(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request);
  if (authError) return authError;

  const url = new URL(request.url);
  let windowMinutes = Number(url.searchParams.get("windowMinutes") ?? DEFAULT_WINDOW_MIN);
  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) {
    windowMinutes = DEFAULT_WINDOW_MIN;
  }
  windowMinutes = Math.min(windowMinutes, MAX_WINDOW_MIN);

  const since = new Date(Date.now() - windowMinutes * 60_000);
  const db = getDb();

  // Fast path: any recent match at all? Skip the join if none.
  const recent = await db
    .select({ id: subwayTripMatches.id })
    .from(subwayTripMatches)
    .where(and(eq(subwayTripMatches.userId, user.id), gte(subwayTripMatches.subEndTime, since)))
    .orderBy(desc(subwayTripMatches.subEndTime))
    .limit(1);

  if (recent.length === 0) {
    return NextResponse.json(
      { active: false, windowMinutes },
      { headers: { "Cache-Control": "private, max-age=30" } }
    );
  }

  const detailRes = await db.execute(sql`
    WITH numbered_lines AS (
      SELECT id, system_id, name, ref, colour, network,
             CASE WHEN colour IS NULL
                  THEN (ROW_NUMBER() OVER (PARTITION BY system_id, (colour IS NULL)
                                            ORDER BY ref, name, id) - 1)
                  ELSE 0 END AS fallback_idx
      FROM subway_lines
    )
    SELECT
      m.id::text                  AS match_id,
      m.sub_start_time             AS sub_start_time,
      m.sub_end_time               AS sub_end_time,
      m.total_confidence           AS total_confidence,
      l.id::text                   AS line_id,
      l.ref                        AS line_ref,
      l.name                       AS line_name,
      l.colour                     AS line_colour,
      l.network                    AS line_network,
      l.fallback_idx               AS fallback_idx,
      ss_start.name                AS start_station_name,
      ss_end.name                  AS end_station_name
    FROM subway_trip_matches m
    JOIN numbered_lines l ON l.id = m.line_id
    LEFT JOIN subway_stations ss_start ON ss_start.id = m.start_station_id
    LEFT JOIN subway_stations ss_end ON ss_end.id = m.end_station_id
    WHERE m.user_id = ${user.id}::uuid
      AND m.sub_end_time >= ${since}
    ORDER BY m.sub_end_time DESC
    LIMIT 1
  `);

  const row = (detailRes.rows[0] ?? null) as unknown as CurrentActivityRow | null;
  if (!row) {
    return NextResponse.json(
      { active: false, windowMinutes },
      { headers: { "Cache-Control": "private, max-age=30" } }
    );
  }

  const subEndTime = new Date(row.sub_end_time);
  const minutesAgo = Math.max(0, Math.round((Date.now() - subEndTime.getTime()) / 60_000));
  const lineColor = resolveLineColor({
    colour: row.line_colour,
    network: row.line_network,
    ref: row.line_ref,
    name: row.line_name,
    fallbackIndex: Number(row.fallback_idx) || 0,
  });

  return NextResponse.json(
    {
      active: true,
      minutesAgo,
      windowMinutes,
      line: {
        id: row.line_id,
        ref: row.line_ref,
        name: row.line_name,
        color: lineColor,
      },
      startStationName: row.start_station_name,
      endStationName: row.end_station_name,
      subStartTime: new Date(row.sub_start_time).toISOString(),
      subEndTime: subEndTime.toISOString(),
      totalConfidence: Number(row.total_confidence),
    },
    {
      // Short cache — this endpoint is meant to be polled.
      headers: { "Cache-Control": "private, max-age=30" },
    }
  );
}
