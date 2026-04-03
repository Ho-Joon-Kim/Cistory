/**
 * Year Comparison API
 *
 * GET /api/reports/comparison?year1=YYYY&year2=YYYY
 * Returns side-by-side metrics, deltas, growth rates, and monthly comparison.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { compareYears } from "@/modules/report/comparison-service";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const year1 = request.nextUrl.searchParams.get("year1");
    const year2 = request.nextUrl.searchParams.get("year2");

    if (
      !year1 ||
      !year2 ||
      !/^\d{4}$/.test(year1) ||
      !/^\d{4}$/.test(year2)
    ) {
      return NextResponse.json(
        { error: "year1, year2 파라미터가 필요합니다 (YYYY)" },
        { status: 400 },
      );
    }

    const result = await compareYears(user.id, year1, year2);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Year comparison error:", error);
    return NextResponse.json(
      { error: "연도 비교에 실패했습니다" },
      { status: 500 },
    );
  }
}
