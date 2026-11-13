/**
 * Spending API (session-authenticated)
 *
 * GET /api/spending?from=2026-03-01&to=2026-03-31&bucket=spending&limit=30&offset=0
 * Returns parsed transaction records with summary stats for the logged-in user.
 *
 * Each row is annotated with `bucket` ('spending' | 'income' | 'ignore') based
 * on per-transaction overrides + the user's account_roles configuration. Pass
 * `?bucket=spending|income|ignore` to filter, or `?type=withdrawal|deposit` for
 * the legacy raw-type filter.
 *
 * Rows also carry `isRefund` (an income deposit from a merchant the user has
 * paid — see modules/spending/refund.ts) and `summary.flow` splits income into
 * refunds and other money received, for the page's net-spending view.
 */

import { type NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { getSpendingPeriod } from "@/modules/spending/service";

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getAuthenticatedUser(request);
    if (error) return error;

    const params = request.nextUrl.searchParams;
    const result = await getSpendingPeriod(user.id, {
      from: params.get("from"),
      to: params.get("to"),
      type: params.get("type"), // 'withdrawal' | 'deposit' | null (legacy)
      bucket: params.get("bucket"), // 'spending' | 'income' | 'ignore' | null
      limit: Math.min(Number(params.get("limit")) || 30, 200),
      offset: Number(params.get("offset")) || 0,
    });

    return NextResponse.json(result);
  } catch (error) {
    const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
    const pg = (cause ?? error) as {
      message?: string;
      code?: string;
      detail?: string;
      hint?: string;
      position?: string;
      where?: string;
      schema?: string;
      table?: string;
      column?: string;
      dataType?: string;
      constraint?: string;
    };
    logger.error("Spending fetch error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      pgMessage: pg?.message,
      pgCode: pg?.code,
      pgDetail: pg?.detail,
      pgHint: pg?.hint,
      pgPosition: pg?.position,
      pgWhere: pg?.where,
      pgTable: pg?.table,
      pgColumn: pg?.column,
      pgConstraint: pg?.constraint,
    });
    return NextResponse.json(
      { error: "소비 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
