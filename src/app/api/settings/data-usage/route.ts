/**
 * Data Usage API Route
 *
 * GET  /api/settings/data-usage - 캐시에서 데이터 용량 조회
 * POST /api/settings/data-usage - 즉시 재계산 후 응답
 */

import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { calculateDataUsage, formatDataUsageResponse, getDataUsage } from "@/lib/data-usage";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const db = getDb();
    const rows = await getDataUsage(db, user.id);
    return NextResponse.json(formatDataUsageResponse(rows));
  } catch (error) {
    logger.error("Get data usage error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "데이터 사용량 조회에 실패했습니다" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const db = getDb();
    const rows = await calculateDataUsage(db, user.id);
    return NextResponse.json(formatDataUsageResponse(rows));
  } catch (error) {
    logger.error("Calculate data usage error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "데이터 사용량 계산에 실패했습니다" }, { status: 500 });
  }
}
