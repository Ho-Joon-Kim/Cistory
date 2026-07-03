/**
 * Stay Points Detection API
 *
 * GET /api/timeline/locations/stay-points?date=YYYY-MM-DD
 *
 * Detects visits, enriches with geocoding, persists to visits table,
 * and returns enriched stay point data.
 */

import { and, asc, eq, gte, lt } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb, visits } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { endOfLocalDay, startOfLocalDay, toLocalDateString } from "@/lib/utils";
import {
  detectAndPersistVisits,
  type EnrichedVisit,
} from "@/modules/location/services/visit-persister";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const dateParam = request.nextUrl.searchParams.get("date");
    if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return NextResponse.json(
        { error: "date 파라미터가 필요합니다 (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    // P9: a GET used to detect+persist on every call, which meant polling
    // this endpoint (the dashboard does it once a minute while viewing today)
    // re-ran DBSCAN + geocoding + transactional DELETE/INSERT every time.
    // For past dates the daily cron already populated `visits`, so we just
    // read. Today still triggers the detect+persist path so fresh GPS data
    // becomes visible before 01:00 cron.
    const today = toLocalDateString(new Date());
    const isToday = dateParam === today;

    let enrichedVisits: EnrichedVisit[];
    if (isToday) {
      enrichedVisits = await detectAndPersistVisits(user.id, dateParam);
    } else {
      const db = getDb();
      const dayStart = startOfLocalDay(dateParam);
      const dayEnd = endOfLocalDay(dateParam);
      const rows = await db
        .select()
        .from(visits)
        .where(
          and(
            eq(visits.userId, user.id),
            gte(visits.startTime, dayStart),
            lt(visits.startTime, dayEnd)
          )
        )
        .orderBy(asc(visits.startTime));
      enrichedVisits = rows.map((v) => ({
        centerLat: v.centerLat,
        centerLon: v.centerLon,
        radiusM: v.radiusM,
        startTime: v.startTime.toISOString(),
        endTime: v.endTime.toISOString(),
        durationMinutes: Math.round(v.durationSeconds / 60),
        pointCount: 0,
        placeName: v.placeName,
        address: v.address,
        category: v.category,
        city: v.city,
        countryName: v.countryName,
        savedPlaceId: v.savedPlaceId ?? undefined,
      }));
    }

    const stayPoints = enrichedVisits.map((v) => ({
      lat: v.centerLat,
      lon: v.centerLon,
      placeName: v.placeName,
      address: v.address,
      category: v.category,
      savedPlaceId: v.savedPlaceId,
      startTime: v.startTime,
      endTime: v.endTime,
      durationMinutes: v.durationMinutes,
      radiusM: v.radiusM,
      pointCount: v.pointCount,
    }));

    return NextResponse.json({ stayPoints });
  } catch (error) {
    logger.error("Stay points error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Stay point 조회에 실패했습니다" }, { status: 500 });
  }
}
