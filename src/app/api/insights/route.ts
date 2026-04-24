import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { InsightsService } from "@/modules/insights/service";
import { getSubwayInsights } from "@/modules/location/services/subway-match/usage";

const VALID_SECTIONS = new Set([
  "streaks",
  "patterns",
  "routines",
  "digests",
  "commit-heatmap",
  "subway",
]);

function yearBounds(year: number): { from: Date; toExclusive: Date } {
  return {
    from: new Date(year, 0, 1),
    toExclusive: new Date(year + 1, 0, 1),
  };
}

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const yearParam = request.nextUrl.searchParams.get("year");
    if (!yearParam || !/^\d{4}$/.test(yearParam)) {
      return NextResponse.json({ error: "year 파라미터가 필요합니다 (YYYY)" }, { status: 400 });
    }

    const section = request.nextUrl.searchParams.get("section");
    const year = parseInt(yearParam, 10);
    const db = getDb();

    // P2: /api/insights?year=... (no section) returns all five sections in one
    // round-trip, so clients that render the full page in parallel don't have
    // to fire five separate requests (each running its own overlapping COUNT
    // over commits). Per-section calls stay supported for any caller that
    // wants section-level lazy loading.
    if (!section) {
      const { from, toExclusive } = yearBounds(year);
      const [streaks, patterns, routines, digests, commitHeatmap, subway] = await Promise.all([
        InsightsService.calculateStreaks(db, user.id, year),
        InsightsService.calculateWorkPatterns(db, user.id, year),
        InsightsService.calculateRoutinePatterns(db, user.id, year),
        InsightsService.calculateMonthlyDigests(db, user.id, year),
        InsightsService.getCommitHeatmapData(db, user.id, year),
        getSubwayInsights(user.id, from, toExclusive),
      ]);
      return NextResponse.json({
        streaks,
        patterns,
        routines,
        digests,
        commitHeatmap,
        subway,
      });
    }

    if (!VALID_SECTIONS.has(section)) {
      return NextResponse.json(
        {
          error:
            "유효하지 않은 section 파라미터입니다 (streaks, patterns, routines, digests, commit-heatmap, subway)",
        },
        { status: 400 }
      );
    }

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
      case "subway": {
        const { from, toExclusive } = yearBounds(year);
        const data = await getSubwayInsights(user.id, from, toExclusive);
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
