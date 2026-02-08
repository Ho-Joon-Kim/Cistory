/**
 * Coding Sessions Query API
 *
 * GET /api/timeline/coding-sessions?date=YYYY-MM-DD
 * Returns coding sessions for a given date, ordered by startedAt.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers";
import { getDb } from "@/db";
import { codingSessions } from "@/db/schema";
import { eq, and, gte, lt, asc } from "drizzle-orm";

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

    // tz = timezone offset in minutes (from getTimezoneOffset(), e.g. -540 for KST)
    const tzParam = request.nextUrl.searchParams.get("tz");
    const tzOffsetMinutes = tzParam ? Number.parseInt(tzParam, 10) : 0;
    const tzOffsetMs = tzOffsetMinutes * 60 * 1000;

    // Convert local date boundaries to UTC
    const dayStart = new Date(new Date(`${dateParam}T00:00:00.000Z`).getTime() + tzOffsetMs);
    const dayEnd = new Date(new Date(`${dateParam}T23:59:59.999Z`).getTime() + tzOffsetMs);

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
    return NextResponse.json(
      { error: "코딩 세션 조회에 실패했습니다" },
      { status: 500 }
    );
  }
}
