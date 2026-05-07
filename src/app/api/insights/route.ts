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
  "swimlane",
  "ai-clock",
  "commute-reliability",
  "place-productivity",
  "trips",
  "transport-modes",
  "visits-x-commits",
  "net-spend",
  "repo-split",
  "data-usage",
  "discoveries",
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

    if (!section) {
      // No section: return all sections in one round-trip.
      const { from, toExclusive } = yearBounds(year);
      const [
        streaks,
        patterns,
        routines,
        digests,
        commitHeatmap,
        subway,
        swimlane,
        aiClock,
        commute,
        placeProductivity,
        trips,
        transport,
        visitsXCommits,
        netSpend,
        repoSplit,
        dataUsage,
        discoveries,
      ] = await Promise.all([
        InsightsService.calculateStreaks(db, user.id, year),
        InsightsService.calculateWorkPatterns(db, user.id, year),
        InsightsService.calculateRoutinePatterns(db, user.id, year),
        InsightsService.calculateMonthlyDigests(db, user.id, year),
        InsightsService.getCommitHeatmapData(db, user.id, year),
        getSubwayInsights(user.id, from, toExclusive),
        InsightsService.getYearSwimlane(db, user.id, year),
        InsightsService.getAIClock(db, user.id, year),
        InsightsService.getCommuteReliability(db, user.id, year),
        InsightsService.getPlaceProductivity(db, user.id, year),
        InsightsService.getTrips(db, user.id, year),
        InsightsService.getTransportModes(db, user.id, year),
        InsightsService.getVisitsXCommits(db, user.id, year),
        InsightsService.getNetSpend(db, user.id, year),
        InsightsService.getRepoSplit(db, user.id, year),
        InsightsService.getDataUsage(db, user.id),
        InsightsService.getDiscoveries(db, user.id, year),
      ]);
      return NextResponse.json({
        streaks,
        patterns,
        routines,
        digests,
        commitHeatmap,
        subway,
        swimlane,
        aiClock,
        commute,
        placeProductivity,
        trips,
        transport,
        visitsXCommits,
        netSpend,
        repoSplit,
        dataUsage,
        discoveries,
      });
    }

    if (!VALID_SECTIONS.has(section)) {
      return NextResponse.json({ error: "유효하지 않은 section 파라미터입니다" }, { status: 400 });
    }

    switch (section) {
      case "streaks":
        return NextResponse.json({
          data: await InsightsService.calculateStreaks(db, user.id, year),
        });
      case "patterns":
        return NextResponse.json({
          data: await InsightsService.calculateWorkPatterns(db, user.id, year),
        });
      case "routines":
        return NextResponse.json({
          data: await InsightsService.calculateRoutinePatterns(db, user.id, year),
        });
      case "digests":
        return NextResponse.json({
          data: await InsightsService.calculateMonthlyDigests(db, user.id, year),
        });
      case "commit-heatmap":
        return NextResponse.json({
          data: await InsightsService.getCommitHeatmapData(db, user.id, year),
        });
      case "subway": {
        const { from, toExclusive } = yearBounds(year);
        return NextResponse.json({ data: await getSubwayInsights(user.id, from, toExclusive) });
      }
      case "swimlane":
        return NextResponse.json({
          data: await InsightsService.getYearSwimlane(db, user.id, year),
        });
      case "ai-clock":
        return NextResponse.json({ data: await InsightsService.getAIClock(db, user.id, year) });
      case "commute-reliability":
        return NextResponse.json({
          data: await InsightsService.getCommuteReliability(db, user.id, year),
        });
      case "place-productivity":
        return NextResponse.json({
          data: await InsightsService.getPlaceProductivity(db, user.id, year),
        });
      case "trips":
        return NextResponse.json({ data: await InsightsService.getTrips(db, user.id, year) });
      case "transport-modes":
        return NextResponse.json({
          data: await InsightsService.getTransportModes(db, user.id, year),
        });
      case "visits-x-commits":
        return NextResponse.json({
          data: await InsightsService.getVisitsXCommits(db, user.id, year),
        });
      case "net-spend":
        return NextResponse.json({ data: await InsightsService.getNetSpend(db, user.id, year) });
      case "repo-split":
        return NextResponse.json({ data: await InsightsService.getRepoSplit(db, user.id, year) });
      case "data-usage":
        return NextResponse.json({ data: await InsightsService.getDataUsage(db, user.id) });
      case "discoveries":
        return NextResponse.json({ data: await InsightsService.getDiscoveries(db, user.id, year) });
      default:
        return NextResponse.json({ error: "유효하지 않은 section" }, { status: 400 });
    }
  } catch (error) {
    console.error("Get insights error:", error);
    return NextResponse.json({ error: "인사이트 조회에 실패했습니다" }, { status: 500 });
  }
}
