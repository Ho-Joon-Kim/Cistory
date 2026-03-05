import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { createSpendingTrendService } from "@/modules/spending/service";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getAuthenticatedUser(request);
    if (error) return error;

    const service = createSpendingTrendService(getDb());
    const data = await service.getSpendingTrend(user.id);

    return NextResponse.json(data);
  } catch (error) {
    logger.error("Spending trend fetch error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "조회 실패" }, { status: 500 });
  }
}
