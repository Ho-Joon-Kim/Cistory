/**
 * Data Usage API Route
 *
 * GET  /api/settings/data-usage - 캐시에서 데이터 용량 조회
 * POST /api/settings/data-usage - 즉시 재계산 후 응답
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers";
import { getDb } from "@/db";
import {
  getDataUsage,
  calculateDataUsage,
  formatDataUsageResponse,
} from "@/lib/data-usage";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const db = getDb();
    const rows = await getDataUsage(db, user.id);
    return NextResponse.json(formatDataUsageResponse(rows));
  } catch (error) {
    console.error("Get data usage error:", error);
    return NextResponse.json(
      { error: "Failed to get data usage" },
      { status: 500 }
    );
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
    console.error("Calculate data usage error:", error);
    return NextResponse.json(
      { error: "Failed to calculate data usage" },
      { status: 500 }
    );
  }
}
