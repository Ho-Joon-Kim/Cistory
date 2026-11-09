import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { withAuth } from "@/lib/api-handler";
import {
  createDatabaseOverviewHistoryStore,
  getOverviewHistory,
} from "@/modules/overview/history-store";

/** Stored-only period history for the overview hero (never aggregates on demand). */
export const GET = withAuth(async ({ user, request }) => {
  const periodType = request.nextUrl.searchParams.get("periodType") ?? "";
  const periodKey = request.nextUrl.searchParams.get("periodKey") ?? "";
  const history = await getOverviewHistory(
    createDatabaseOverviewHistoryStore(getDb()),
    user.id,
    periodType,
    periodKey
  );
  return NextResponse.json(history, { headers: { "Cache-Control": "private, no-store" } });
});
