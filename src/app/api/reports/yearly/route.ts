/**
 * Yearly Report API Route
 *
 * GET /api/reports/yearly?year=2026 → 전체 데이터 집계 (하위 호환)
 * GET /api/reports/yearly?year=2026&section=commits → 커밋 섹션만
 * GET /api/reports/yearly?year=2026&section=coding → 코딩 섹션만
 * GET /api/reports/yearly?year=2026&section=location → 위치 섹션만
 * POST /api/reports/yearly { year: "2026" } → AI 내러티브 생성
 */

import { getDb } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { createReportService } from "@/modules/report/service";
import { type NextRequest, NextResponse } from "next/server";

const VALID_SECTIONS = new Set(["commits", "coding", "location", "cross"]);

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const year = request.nextUrl.searchParams.get("year");
    if (!year || !/^\d{4}$/.test(year)) {
      return NextResponse.json({ error: "year 파라미터가 필요합니다 (YYYY)" }, { status: 400 });
    }

    const section = request.nextUrl.searchParams.get("section");
    if (section && !VALID_SECTIONS.has(section)) {
      return NextResponse.json(
        { error: "유효하지 않은 section 파라미터입니다 (commits, coding, location, cross)" },
        { status: 400 }
      );
    }

    const enriched = request.nextUrl.searchParams.get("enriched") === "true";
    const db = getDb();
    const service = createReportService(db);

    if (section === "commits") {
      // Enriched yearly not yet implemented — return base yearly data
      const data = await service.aggregateYearlyCommits(user.id, year);
      return NextResponse.json({ data });
    }
    if (section === "coding") {
      const data = await service.aggregateYearlyCoding(user.id, year);
      return NextResponse.json({ data });
    }
    if (section === "location") {
      const data = await service.aggregateYearlyLocation(user.id, year);
      return NextResponse.json({ data });
    }
    if (section === "cross") {
      // Cross analysis uses monthly functions internally — not supported for yearly
      return NextResponse.json({ data: null });
    }

    // No section → full aggregation (backward compat)
    const data = await service.aggregateYearlyData(user.id, year);
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Get yearly report error:", error);
    return NextResponse.json({ error: "보고서 조회에 실패했습니다" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const body = (await request.json()) as { year?: string };
    const year = body.year;
    if (!year || !/^\d{4}$/.test(year)) {
      return NextResponse.json({ error: "year 파라미터가 필요합니다 (YYYY)" }, { status: 400 });
    }

    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      return NextResponse.json({ error: "AI 기능이 설정되지 않았습니다" }, { status: 500 });
    }

    const db = getDb();
    const service = createReportService(db, anthropicApiKey);

    const data = await service.aggregateYearlyData(user.id, year);

    // Collect enriched data for deeper narrative
    const [enrichedCommits, enrichedCoding, crossAnalysis] = await Promise.all([
      service.aggregateEnrichedMonthlyCommits(user.id, year),
      service.aggregateEnrichedMonthlyCoding(user.id, year),
      service.aggregateCrossAnalysis(user.id, year),
    ]);

    const narrative = await service.generateYearlyNarrative(user.id, year, data, {
      workLifeBalance: enrichedCommits.workLifeBalance,
      deepWorkStats: enrichedCoding.deepWorkStats,
      categoryBreakdown: enrichedCoding.categoryBreakdown,
      contextSwitching: enrichedCoding.contextSwitching,
      placeProductivity: crossAnalysis.placeProductivity,
      routinePatterns: crossAnalysis.routinePatterns,
    });

    return NextResponse.json({ narrative });
  } catch (error) {
    console.error("Generate yearly narrative error:", error);
    return NextResponse.json({ error: "내러티브 생성에 실패했습니다" }, { status: 500 });
  }
}
