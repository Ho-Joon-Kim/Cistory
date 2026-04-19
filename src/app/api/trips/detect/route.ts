/**
 * Trip Auto-Detection API
 *
 * POST /api/trips/detect         — Detect trips (dry run, not persisted)
 * POST /api/trips/detect/confirm — Persist detected trips
 */

import { type NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import {
  type DetectedTrip,
  detectTrips,
  persistTrips,
} from "@/modules/location/services/trip-detector";

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const body = await request.json();
    const { from, to, confirm } = body;

    if (!from || !to) {
      return NextResponse.json(
        { error: "from, to 날짜가 필요합니다 (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    // If confirm mode: persist the provided trips
    if (confirm && Array.isArray(body.trips)) {
      const count = await persistTrips(user.id, body.trips as DetectedTrip[]);
      return NextResponse.json({
        message: `${count}개 여행이 저장되었습니다`,
        saved: count,
      });
    }

    // Default: detect trips (dry run)
    const detected = await detectTrips(user.id, from, to);

    return NextResponse.json({
      trips: detected,
      total: detected.length,
    });
  } catch (error) {
    console.error("Trip detect error:", error);
    return NextResponse.json({ error: "여행 감지에 실패했습니다" }, { status: 500 });
  }
}
