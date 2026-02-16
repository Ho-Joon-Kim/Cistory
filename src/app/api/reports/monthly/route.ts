/**
 * Monthly Report API Route
 *
 * GET /api/reports/monthly?yearMonth=2026-02 → 전체 데이터 집계 (하위 호환)
 * GET /api/reports/monthly?yearMonth=2026-02&section=commits → 커밋 섹션만
 * GET /api/reports/monthly?yearMonth=2026-02&section=coding → 코딩 섹션만
 * GET /api/reports/monthly?yearMonth=2026-02&section=location → 위치 섹션만
 * POST /api/reports/monthly { yearMonth: "2026-02" } → AI 내러티브 생성
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers";
import { getDb } from "@/db";
import { createReportService } from "@/modules/report/service";

const VALID_SECTIONS = new Set(["commits", "coding", "location"]);

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const yearMonth = request.nextUrl.searchParams.get("yearMonth");
    if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
      return NextResponse.json(
        { error: "yearMonth 파라미터가 필요합니다 (YYYY-MM)" },
        { status: 400 }
      );
    }

    const section = request.nextUrl.searchParams.get("section");
    if (section && !VALID_SECTIONS.has(section)) {
      return NextResponse.json(
        { error: "유효하지 않은 section 파라미터입니다 (commits, coding, location)" },
        { status: 400 }
      );
    }

    const db = getDb();
    const service = createReportService(db);

    if (section === "commits") {
      const data = await service.aggregateMonthlyCommits(user.id, yearMonth);
      return NextResponse.json({ data });
    }
    if (section === "coding") {
      const data = await service.aggregateMonthlyCoding(user.id, yearMonth);
      return NextResponse.json({ data });
    }
    if (section === "location") {
      const data = await service.aggregateMonthlyLocation(user.id, yearMonth);
      return NextResponse.json({ data });
    }

    // No section → full aggregation (backward compat)
    const data = await service.aggregateMonthlyData(user.id, yearMonth);
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Get monthly report error:", error);
    return NextResponse.json({ error: "보고서 조회에 실패했습니다" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const body = (await request.json()) as { yearMonth?: string; data?: unknown };
    const yearMonth = body.yearMonth;
    if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
      return NextResponse.json(
        { error: "yearMonth 파라미터가 필요합니다 (YYYY-MM)" },
        { status: 400 }
      );
    }

    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      return NextResponse.json({ error: "AI 기능이 설정되지 않았습니다" }, { status: 500 });
    }

    const db = getDb();
    const service = createReportService(db, anthropicApiKey);

    // Aggregate data if not provided, then generate narrative
    const data = await service.aggregateMonthlyData(user.id, yearMonth);
    const narrative = await service.generateMonthlyNarrative(user.id, yearMonth, data);

    return NextResponse.json({ narrative });
  } catch (error) {
    console.error("Generate monthly narrative error:", error);
    return NextResponse.json({ error: "내러티브 생성에 실패했습니다" }, { status: 500 });
  }
}
