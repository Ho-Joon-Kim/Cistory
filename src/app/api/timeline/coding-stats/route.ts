/**
 * Coding Daily Stats Query API
 *
 * GET /api/timeline/coding-stats?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns daily coding stats for a date range.
 */

import { type NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { getCodingStats } from "@/modules/timeline/work-queries";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const from = request.nextUrl.searchParams.get("from");
    const to = request.nextUrl.searchParams.get("to");
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    if (!from || !to || !dateRegex.test(from) || !dateRegex.test(to)) {
      return NextResponse.json(
        { error: "from, to 파라미터가 필요합니다 (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    const stats = await getCodingStats(user.id, from, to);

    return NextResponse.json({ stats });
  } catch (error) {
    logger.error("Get coding stats error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "코딩 통계를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
