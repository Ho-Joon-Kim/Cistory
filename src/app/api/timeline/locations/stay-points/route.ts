/**
 * Stay Points Detection API
 *
 * GET /api/timeline/locations/stay-points?date=YYYY-MM-DD
 *
 * Detects visits, enriches with geocoding, persists to visits table,
 * and returns enriched stay point data.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { detectAndPersistVisits } from "@/modules/location/services/visit-persister";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const dateParam = request.nextUrl.searchParams.get("date");
    if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return NextResponse.json(
        { error: "date 파라미터가 필요합니다 (YYYY-MM-DD)" },
        { status: 400 },
      );
    }

    const enrichedVisits = await detectAndPersistVisits(user.id, dateParam);

    // Map to frontend-compatible format
    const stayPoints = enrichedVisits.map((v) => ({
      lat: v.centerLat,
      lon: v.centerLon,
      placeName: v.placeName,
      address: v.address,
      category: v.category,
      savedPlaceId: v.savedPlaceId,
      icon: v.icon,
      color: v.color,
      startTime: v.startTime,
      endTime: v.endTime,
      durationMinutes: v.durationMinutes,
      radiusM: v.radiusM,
      pointCount: v.pointCount,
    }));

    return NextResponse.json({ stayPoints });
  } catch (error) {
    console.error("Stay points error:", error);
    return NextResponse.json(
      { error: "Stay point 조회에 실패했습니다" },
      { status: 500 },
    );
  }
}
