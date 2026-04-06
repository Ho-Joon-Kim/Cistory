import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { getDb } from "@/db";
import { InsightsService } from "@/modules/insights/service";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const db = getDb();
    const searchParams = request.nextUrl.searchParams;
    const year = parseInt(searchParams.get("year") ?? String(new Date().getFullYear()), 10);
    const section = searchParams.get("section");

    if (!section) {
      return NextResponse.json({ error: "section parameter is required" }, { status: 400 });
    }

    const userId = user.id;

    switch (section) {
      case "streaks": {
        const data = await InsightsService.calculateStreaks(db, userId, year);
        return NextResponse.json(data);
      }
      case "patterns": {
        const data = await InsightsService.calculateWorkPatterns(db, userId, year);
        return NextResponse.json(data);
      }
      case "routines": {
        const data = await InsightsService.calculateRoutinePatterns(db, userId, year);
        return NextResponse.json(data);
      }
      case "digests": {
        const data = await InsightsService.calculateMonthlyDigests(db, userId, year);
        return NextResponse.json(data);
      }
      case "commit-heatmap": {
        const data = await InsightsService.getCommitHeatmapData(db, userId, year);
        return NextResponse.json(data);
      }
      default:
        return NextResponse.json({ error: `Unknown section: ${section}` }, { status: 400 });
    }
  } catch (err) {
    console.error("Insights API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
