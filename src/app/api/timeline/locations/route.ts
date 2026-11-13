/**
 * Location Data Query API
 *
 * GET /api/timeline/locations?date=YYYY-MM-DD
 * Returns location points for a given date, ordered by timestamp.
 * Filters out low-accuracy points (>200m) and downsamples if >500 points.
 */

import { type NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { getDayLocationPoints } from "@/modules/location/queries";

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

    const locations = await getDayLocationPoints(user.id, dateParam, {
      accuracy: request.nextUrl.searchParams.get("accuracy") !== "false",
      minDistance: request.nextUrl.searchParams.get("minDistance") !== "false",
      downsample: request.nextUrl.searchParams.get("downsample") !== "false",
    });

    return NextResponse.json({
      locations,
      count: locations.length,
    });
  } catch (error) {
    logger.error("Get locations error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "위치 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
