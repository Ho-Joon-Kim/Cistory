import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { withAuth } from "@/lib/api-handler";
import { createDatabaseOverviewStore, createOverviewService } from "@/modules/overview/service";

export const GET = withAuth(async ({ user, request }) => {
  const periodType = request.nextUrl.searchParams.get("periodType") ?? "";
  const periodKey = request.nextUrl.searchParams.get("periodKey") ?? "";
  const service = createOverviewService(createDatabaseOverviewStore(getDb()));

  return NextResponse.json(await service.getSnapshot(user.id, periodType, periodKey));
});
