/**
 * Stay Points Detection API
 *
 * GET /api/timeline/locations/stay-points?date=YYYY-MM-DD
 *
 * Detects visits, enriches with geocoding, persists to visits table,
 * and returns enriched stay point data.
 */

import { type NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { toLocalDateString } from "@/lib/utils";
import { getPersistedDayVisits } from "@/modules/location/queries";
import {
  detectAndPersistVisits,
  type EnrichedVisit,
} from "@/modules/location/services/visit-persister";

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
      enrichedVisits = await getPersistedDayVisits(user.id, dateParam);
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
    return NextResponse.json(
      { error: "체류 지점을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
