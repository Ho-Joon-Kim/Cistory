import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { withAuth } from "@/lib/api-handler";
import { parseSearchInput } from "@/modules/search/input";
import { searchRecords } from "@/modules/search/service";

export const GET = withAuth(async ({ user, request }) => {
  const input = parseSearchInput(request.nextUrl.searchParams);
  // Drizzle errors may contain query parameters (including personal search terms).
  const result = await searchRecords(getDb(), user.id, input).catch(() => {
    throw new Error("기록을 검색하지 못했어요. 잠시 후 다시 시도해 주세요.");
  });
  return NextResponse.json(result, {
    headers: { "Cache-Control": "private, no-store" },
  });
});
