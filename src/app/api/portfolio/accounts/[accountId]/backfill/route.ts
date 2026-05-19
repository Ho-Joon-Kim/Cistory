import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { brokerageAccounts, getDb } from "@/db";
import { ApiError, withAuth } from "@/lib/api-handler";
import { createPortfolioSyncService } from "@/modules/portfolio/service";

interface RouteParams {
  params: Promise<{ accountId: string }>;
}

export const POST = withAuth<RouteParams>(async ({ user }, { params }) => {
  const { accountId } = await params;
  const db = getDb();

  const owned = await db
    .select({ id: brokerageAccounts.id })
    .from(brokerageAccounts)
    .where(and(eq(brokerageAccounts.id, accountId), eq(brokerageAccounts.userId, user.id)))
    .limit(1);
  if (owned.length === 0) {
    throw new ApiError(404, "계좌를 찾을 수 없습니다", "NOT_FOUND");
  }

  const sync = createPortfolioSyncService(db);
  const result = await sync.backfillAccount(accountId);

  return NextResponse.json({ result });
});
