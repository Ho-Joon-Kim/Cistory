/**
 * First-time Visits API
 *
 * GET /api/timeline/locations/first-visits?year=YYYY          — yearly first visits
 * GET /api/timeline/locations/first-visits?yearMonth=YYYY-MM  — monthly first visits
 */

import { type NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import {
  getFirstVisitsByMonth,
  getFirstVisitsByYear,
} from "@/modules/location/services/first-visits";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const yearParam = request.nextUrl.searchParams.get("year");
    const yearMonthParam = request.nextUrl.searchParams.get("yearMonth");

    if (yearMonthParam && /^\d{4}-\d{2}$/.test(yearMonthParam)) {
      const result = await getFirstVisitsByMonth(user.id, yearMonthParam);
      return NextResponse.json(result);
    }

    if (yearParam && /^\d{4}$/.test(yearParam)) {
      const result = await getFirstVisitsByYear(user.id, yearParam);
      return NextResponse.json(result);
    }

    return NextResponse.json(
      { error: "year (YYYY) 또는 yearMonth (YYYY-MM) 파라미터가 필요합니다" },
      { status: 400 }
    );
  } catch (error) {
    console.error("First visits error:", error);
    return NextResponse.json({ error: "최초 방문 조회에 실패했습니다" }, { status: 500 });
  }
}
