/**
 * Residency Tracking API
 *
 * GET /api/timeline/locations/residency?year=YYYY
 * Returns days spent in each country, consecutive periods, and 183-day tax warnings.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { calculateResidency } from "@/modules/location/services/residency";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const yearParam = request.nextUrl.searchParams.get("year");
    if (!yearParam || !/^\d{4}$/.test(yearParam)) {
      return NextResponse.json(
        { error: "year 파라미터가 필요합니다 (YYYY)" },
        { status: 400 },
      );
    }

    const result = await calculateResidency(user.id, yearParam);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Residency error:", error);
    return NextResponse.json(
      { error: "거주지 추적 조회에 실패했습니다" },
      { status: 500 },
    );
  }
}
