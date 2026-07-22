/**
 * Trip Auto-Detection API
 *
 * POST /api/trips/detect         — Detect trips (dry run, not persisted)
 * POST /api/trips/detect/confirm — Persist detected trips
 */

import { type NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import {
  type DetectedTrip,
  detectTrips,
  isValidTripDateRange,
  persistTrips,
} from "@/modules/location/services/trip-detector";
import { isValidDetectedTrip } from "@/modules/location/services/trip-writer";

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "유효하지 않은 JSON 본문입니다" }, { status: 400 });
    }
    const { from, to, confirm } = body;

    // If confirm mode: persist the provided trips
    if (confirm === true) {
      if (!Array.isArray(body.trips) || !body.trips.every(isValidDetectedTrip)) {
        return NextResponse.json({ error: "유효한 여행 후보가 필요합니다" }, { status: 400 });
      }
      const count = await persistTrips(user.id, body.trips as DetectedTrip[]);
      return NextResponse.json({
        message: `${count}개 여행이 저장되었습니다`,
        saved: count,
      });
    }

    if (typeof from !== "string" || typeof to !== "string" || !isValidTripDateRange(from, to)) {
      return NextResponse.json(
        { error: "유효한 from, to 날짜가 필요합니다 (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    // Default: detect trips (dry run)
    const detected = await detectTrips(user.id, from, to);

    return NextResponse.json({
      trips: detected,
      total: detected.length,
    });
  } catch (error) {
    logger.error("Trip detect error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "여행 감지에 실패했습니다" }, { status: 500 });
  }
}
