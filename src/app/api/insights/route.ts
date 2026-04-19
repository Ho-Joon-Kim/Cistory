import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { InsightsService } from "@/modules/insights/service";

const VALID_SECTIONS = new Set(["streaks", "patterns", "routines", "digests", "commit-heatmap"]);

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const yearParam = request.nextUrl.searchParams.get("year");
    if (!yearParam || !/^\d{4}$/.test(yearParam)) {
      return NextResponse.json({ error: "year 파라미터가 필요합니다 (YYYY)" }, { status: 400 });
    }

    const section = request.nextUrl.searchParams.get("section");
    if (!section || !VALID_SECTIONS.has(section)) {
      return NextResponse.json(
        {
          error:
            "유효하지 않은 section 파라미터입니다 (streaks, patterns, routines, digests, commit-heatmap)",
        },
        { status: 400 }
      );
    }

    const year = parseInt(yearParam, 10);
    const db = getDb();

    switch (section) {
      case "streaks": {
        const data = await InsightsService.calculateStreaks(db, user.id, year);
        return NextResponse.json({ data });
      }
      case "patterns": {
        const data = await InsightsService.calculateWorkPatterns(db, user.id, year);
        return NextResponse.json({ data });
      }
      case "routines": {
        const data = await InsightsService.calculateRoutinePatterns(db, user.id, year);
        return NextResponse.json({ data });
      }
      case "digests": {
        const data = await InsightsService.calculateMonthlyDigests(db, user.id, year);
        return NextResponse.json({ data });
      }
      case "commit-heatmap": {
        const data = await InsightsService.getCommitHeatmapData(db, user.id, year);
        return NextResponse.json({ data });
      }
      default:
        return NextResponse.json({ error: "유효하지 않은 section" }, { status: 400 });
    }
  } catch (error) {
    console.error("Get insights error:", error);
    return NextResponse.json({ error: "인사이트 조회에 실패했습니다" }, { status: 500 });
  }
}
