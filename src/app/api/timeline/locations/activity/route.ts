/**
 * Time-of-Day Activity Analysis API
 *
 * GET /api/timeline/locations/activity?yearMonth=YYYY-MM
 * Returns 7×24 activity heatmap matrix, time-of-day distribution, and streak stats.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { getTimeOfDayAnalysis } from "@/modules/location/services/time-of-day";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const yearMonth = request.nextUrl.searchParams.get("yearMonth");
    if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
      return NextResponse.json(
        { error: "yearMonth 파라미터가 필요합니다 (YYYY-MM)" },
        { status: 400 },
      );
    }

    const [year, month] = yearMonth.split("-").map(Number);
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 1);

    const result = await getTimeOfDayAnalysis(user.id, from, to);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Activity analysis error:", error);
    return NextResponse.json(
      { error: "활동 분석에 실패했습니다" },
      { status: 500 },
    );
  }
}
