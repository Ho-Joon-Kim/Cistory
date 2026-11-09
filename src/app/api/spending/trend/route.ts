import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { createSpendingTrendService } from "@/modules/spending/service";

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
    return NextResponse.json(
      { error: "소비 추이를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
