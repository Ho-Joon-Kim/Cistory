/**
 * Tracks API
 *
 * GET  /api/timeline/locations/tracks?date=YYYY-MM-DD — Fetch tracks with embedded segments
 * POST /api/timeline/locations/tracks?date=YYYY-MM-DD — Trigger track recalculation
 */

import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb, tracks, transportationSegments } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { endOfLocalDay, startOfLocalDay } from "@/lib/utils";
import { detectAndPersistTracks } from "@/modules/location/services/track-persister";

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
