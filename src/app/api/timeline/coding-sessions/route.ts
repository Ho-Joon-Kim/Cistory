/**
 * Coding Sessions Query API
 *
 * GET /api/timeline/coding-sessions?date=YYYY-MM-DD
 * Returns coding sessions for a given date, ordered by startedAt.
 */

import { and, asc, eq, gte, lt } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { codingSessions } from "@/db/schema";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { endOfLocalDay, startOfLocalDay } from "@/lib/utils";

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

    const db = getDb();

    // Use server-local day window (KST in production). The `tz` query param is
    // deprecated — the client-supplied timezone offset previously diverged from
    // server TZ when the backing record already lives in KST, corrupting edge
    // cases around midnight. Single-user KST deployment makes local-day correct.
    const dayStart = startOfLocalDay(dateParam);
    const dayEnd = endOfLocalDay(dateParam);

    const rows = await db
      .select({
        id: codingSessions.id,
        project: codingSessions.project,
        startedAt: codingSessions.startedAt,
        durationSeconds: codingSessions.durationSeconds,
        humanAdditions: codingSessions.humanAdditions,
        humanDeletions: codingSessions.humanDeletions,
        aiAdditions: codingSessions.aiAdditions,
        aiDeletions: codingSessions.aiDeletions,
      })
      .from(codingSessions)
      .where(
        and(
          eq(codingSessions.userId, user.id),
          gte(codingSessions.startedAt, dayStart),
          lt(codingSessions.startedAt, dayEnd)
        )
      )
      .orderBy(asc(codingSessions.startedAt));

    const sessions = rows.map((r) => ({
      id: r.id,
      project: r.project,
      startedAt: r.startedAt.toISOString(),
      durationSeconds: r.durationSeconds,
      humanAdditions: r.humanAdditions,
      humanDeletions: r.humanDeletions,
      aiAdditions: r.aiAdditions,
      aiDeletions: r.aiDeletions,
    }));

    return NextResponse.json({
      sessions,
      count: sessions.length,
    });
  } catch (error) {
    console.error("Get coding sessions error:", error);
    return NextResponse.json({ error: "코딩 세션 조회에 실패했습니다" }, { status: 500 });
  }
}
