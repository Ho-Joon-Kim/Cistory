/**
 * Coding Daily Stats Query API
 *
 * GET /api/timeline/coding-stats?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns daily coding stats for a date range.
 */

import { and, asc, eq, gte, lte } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { codingDailyStats } from "@/db/schema";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";

interface SummaryItem {
  name: string;
  totalSeconds: number;
}

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

    const db = getDb();

    const rows = await db
      .select({
        date: codingDailyStats.date,
        totalSeconds: codingDailyStats.totalSeconds,
        projects: codingDailyStats.projects,
        languages: codingDailyStats.languages,
        editors: codingDailyStats.editors,
        categories: codingDailyStats.categories,
      })
      .from(codingDailyStats)
      .where(
        and(
          eq(codingDailyStats.userId, user.id),
          gte(codingDailyStats.date, from),
          lte(codingDailyStats.date, to)
        )
      )
      .orderBy(asc(codingDailyStats.date));

    const parseJson = (raw: string | null): SummaryItem[] => {
      if (!raw) return [];
      try {
        return JSON.parse(raw) as SummaryItem[];
      } catch {
        return [];
      }
    };

    const stats = rows.map((r) => ({
      date: r.date,
      totalSeconds: r.totalSeconds,
      projects: parseJson(r.projects),
      languages: parseJson(r.languages),
      editors: parseJson(r.editors),
      categories: parseJson(r.categories),
    }));

    return NextResponse.json({ stats });
  } catch (error) {
    logger.error("Get coding stats error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "코딩 통계 조회에 실패했습니다" }, { status: 500 });
  }
}
