import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-handler";
import { getPortfolioSummary } from "@/modules/portfolio/queries";

export const GET = withAuth(async ({ user }) => {
  return NextResponse.json(await getPortfolioSummary(user.id));
});
