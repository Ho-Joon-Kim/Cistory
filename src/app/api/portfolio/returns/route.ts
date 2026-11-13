import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-handler";
import {
  getPortfolioReturns,
  isDateKey,
  PortfolioAccountNotFoundError,
} from "@/modules/portfolio/queries";

export const GET = withAuth(async ({ user, request }) => {
  const url = new URL(request.url);
  const accountId = url.searchParams.get("accountId");
  const from = url.searchParams.get("from"); // YYYY-MM-DD
  const to = url.searchParams.get("to");

  if (
    (from !== null && !isDateKey(from)) ||
    (to !== null && !isDateKey(to)) ||
    (from && to && from > to)
  ) {
    return NextResponse.json({ error: "올바른 날짜 범위를 입력해 주세요" }, { status: 400 });
  }

  try {
    return NextResponse.json(await getPortfolioReturns(user.id, { accountId, from, to }));
  } catch (error) {
    if (error instanceof PortfolioAccountNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
});
