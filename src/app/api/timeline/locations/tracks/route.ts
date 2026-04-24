/**
 * Tracks API
 *
 * GET  /api/timeline/locations/tracks?date=YYYY-MM-DD — Fetch tracks with embedded segments
 * POST /api/timeline/locations/tracks?date=YYYY-MM-DD — Trigger track recalculation
 */

import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb, tracks, transportationSegments } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { resolveLineColor } from "@/lib/subway-color";
import { endOfLocalDay, startOfLocalDay } from "@/lib/utils";
import { detectAndPersistTracks } from "@/modules/location/services/track-persister";

interface SubwayLegRow {
  segment_id: string;
  line_id: string;
  line_ref: string | null;
  line_name: string | null;
  line_colour: string | null;
  line_network: string | null;
  fallback_idx: number | string;
  start_station_name: string | null;
  end_station_name: string | null;
  session_id: string | null;
  leg_order: number | string;
  total_confidence: number | string;
}

interface SubwayLeg {
  lineId: string;
  lineRef: string | null;
  lineName: string | null;
  lineColor: string;
  startStationName: string | null;
  endStationName: string | null;
  sessionId: string | null;
  legOrder: number;
  totalConfidence: number;
}

function parseDateParam(request: NextRequest) {
  const dateParam = request.nextUrl.searchParams.get("date");
  if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return { error: "date 파라미터가 필요합니다 (YYYY-MM-DD)" };
  }
  return { dateParam };
}

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const parsed = parseDateParam(request);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const db = getDb();
    const dayStart = startOfLocalDay(parsed.dateParam);
    const dayEnd = endOfLocalDay(parsed.dateParam);

    // Fetch tracks for the day
    const dayTracks = await db
      .select()
      .from(tracks)
      .where(
        and(
          eq(tracks.userId, user.id),
          gte(tracks.startTime, dayStart),
          lt(tracks.startTime, dayEnd)
        )
      )
      .orderBy(asc(tracks.startTime));

    // Fetch all segments for these tracks in a single query, then group (P6).
    // Previous code issued one SELECT per track (O(N) round-trips); a day
    // with 20+ tracks was taking 20+ DB hits for what is conceptually one join.
    const trackIds = dayTracks.map((t) => t.id);
    const allSegments =
      trackIds.length === 0
        ? []
        : await db
            .select()
            .from(transportationSegments)
            .where(inArray(transportationSegments.trackId, trackIds))
            .orderBy(asc(transportationSegments.startTime));

    const segmentsByTrackId = new Map<string, typeof allSegments>();
    for (const s of allSegments) {
      if (!s.trackId) continue;
      const bucket = segmentsByTrackId.get(s.trackId);
      if (bucket) bucket.push(s);
      else segmentsByTrackId.set(s.trackId, [s]);
    }

    // Fetch subway matches for these segments. ROW_NUMBER provides the same
    // fallback_idx semantics as /api/map/subway so colors stay stable.
    const segmentIds = allSegments.map((s) => s.id);
    const legsBySegmentId = new Map<string, SubwayLeg[]>();
    if (segmentIds.length > 0) {
      const legRes = await db.execute(sql`
        WITH numbered_lines AS (
          SELECT id, system_id, name, name_en, ref, colour, network,
                 CASE WHEN colour IS NULL
                      THEN (ROW_NUMBER() OVER (PARTITION BY system_id, (colour IS NULL)
                                                ORDER BY ref, name, id) - 1)
                      ELSE 0 END AS fallback_idx
          FROM subway_lines
        )
        SELECT
          m.transportation_segment_id::text AS segment_id,
          l.id::text                         AS line_id,
          l.ref                              AS line_ref,
          l.name                             AS line_name,
          l.colour                           AS line_colour,
          l.network                          AS line_network,
          l.fallback_idx                     AS fallback_idx,
          ss_start.name                      AS start_station_name,
          ss_end.name                        AS end_station_name,
          m.session_id::text                 AS session_id,
          m.leg_order                        AS leg_order,
          m.total_confidence                 AS total_confidence
        FROM subway_trip_matches m
        JOIN numbered_lines l ON l.id = m.line_id
        LEFT JOIN subway_stations ss_start ON ss_start.id = m.start_station_id
        LEFT JOIN subway_stations ss_end ON ss_end.id = m.end_station_id
        WHERE m.transportation_segment_id = ANY(${segmentIds}::uuid[])
        ORDER BY m.transportation_segment_id, m.leg_order
      `);
      for (const row of legRes.rows as unknown as SubwayLegRow[]) {
        const leg: SubwayLeg = {
          lineId: row.line_id,
          lineRef: row.line_ref,
          lineName: row.line_name,
          lineColor: resolveLineColor({
            colour: row.line_colour,
            network: row.line_network,
            ref: row.line_ref,
            name: row.line_name,
            fallbackIndex: Number(row.fallback_idx) || 0,
          }),
          startStationName: row.start_station_name,
          endStationName: row.end_station_name,
          sessionId: row.session_id,
          legOrder: Number(row.leg_order),
          totalConfidence: Number(row.total_confidence),
        };
        const bucket = legsBySegmentId.get(row.segment_id);
        if (bucket) bucket.push(leg);
        else legsBySegmentId.set(row.segment_id, [leg]);
      }
    }

    const result = dayTracks.map((track) => ({
      id: track.id,
      startTime: track.startTime.toISOString(),
      endTime: track.endTime.toISOString(),
      distanceMeters: track.distanceMeters,
      durationSeconds: track.durationSeconds,
      pointCount: track.pointCount,
      startPlaceName: track.startPlaceName,
      endPlaceName: track.endPlaceName,
      dominantMode: track.dominantMode,
      elevationGain: track.elevationGain,
      elevationLoss: track.elevationLoss,
      segments: (segmentsByTrackId.get(track.id) ?? []).map((s) => ({
        mode: s.mode,
        confidence: s.confidence,
        startTime: s.startTime.toISOString(),
        endTime: s.endTime.toISOString(),
        distanceMeters: s.distanceMeters,
        durationSeconds: s.durationSeconds,
        avgSpeedKmh: s.avgSpeedKmh,
        maxSpeedKmh: s.maxSpeedKmh,
        subwayLegs: legsBySegmentId.get(s.id) ?? [],
      })),
    }));

    return NextResponse.json({ tracks: result });
  } catch (error) {
    console.error("Tracks GET error:", error);
    return NextResponse.json({ error: "트랙 조회에 실패했습니다" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const parsed = parseDateParam(request);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const result = await detectAndPersistTracks(user.id, parsed.dateParam);

    return NextResponse.json({
      message: `${result.trackCount}개 트랙, ${result.segmentCount}개 세그먼트 생성`,
      ...result,
    });
  } catch (error) {
    console.error("Tracks POST error:", error);
    return NextResponse.json({ error: "트랙 생성에 실패했습니다" }, { status: 500 });
  }
}
