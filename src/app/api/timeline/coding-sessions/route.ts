/**
 * Coding Sessions Query API
 *
 * GET /api/timeline/coding-sessions?date=YYYY-MM-DD
 * Returns coding sessions for a given date, ordered by startedAt.
 */

import { type NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { endOfLocalDay, startOfLocalDay } from "@/lib/utils";
import { listCodingSessions } from "@/modules/timeline/work-queries";

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

    // Use server-local day window (KST in production). The `tz` query param is
    // deprecated — the client-supplied timezone offset previously diverged from
    // server TZ when the backing record already lives in KST, corrupting edge
    // cases around midnight. Single-user KST deployment makes local-day correct.
    const dayStart = startOfLocalDay(dateParam);
    const dayEnd = endOfLocalDay(dateParam);

    const sessions = await listCodingSessions(user.id, { start: dayStart, end: dayEnd });

    return NextResponse.json({
      sessions,
      count: sessions.length,
    });
  } catch (error) {
    logger.error("Get coding sessions error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "코딩 세션을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
