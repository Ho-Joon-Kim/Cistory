import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-handler";
import { getHealthSummary } from "@/modules/health/summary";

/**
 * Curated daily health trends + recent workouts + sleep + connection meta for
 * the /health page (rolling 30-day window). See modules/health/summary.ts.
 */
export const GET = withAuth(async ({ user }) => {
  return NextResponse.json(await getHealthSummary(user.id));
});
