/**
 * Tracks API
 *
 * GET  /api/timeline/locations/tracks?date=YYYY-MM-DD — Fetch tracks with embedded segments
 * POST /api/timeline/locations/tracks?date=YYYY-MM-DD — Trigger track recalculation
 */

import { and, asc, eq, gte, lt } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb, tracks, transportationSegments } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
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
    const dayStart = new Date(`${parsed.dateParam}T00:00:00.000Z`);
    const dayEnd = new Date(`${parsed.dateParam}T23:59:59.999Z`);

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

    // Fetch segments for each track
    const result = await Promise.all(
      dayTracks.map(async (track) => {
        const segments = await db
          .select()
          .from(transportationSegments)
          .where(eq(transportationSegments.trackId, track.id))
          .orderBy(asc(transportationSegments.startTime));

        return {
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
          segments: segments.map((s) => ({
            mode: s.mode,
            confidence: s.confidence,
            startTime: s.startTime.toISOString(),
            endTime: s.endTime.toISOString(),
            distanceMeters: s.distanceMeters,
            durationSeconds: s.durationSeconds,
            avgSpeedKmh: s.avgSpeedKmh,
            maxSpeedKmh: s.maxSpeedKmh,
          })),
        };
      })
    );

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
