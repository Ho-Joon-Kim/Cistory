import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { withAuth } from "@/lib/api-handler";
import { parseSearchInput } from "@/modules/search/input";
import { searchRecords } from "@/modules/search/service";

export const GET = withAuth(async ({ user, request }) => {
  const input = parseSearchInput(request.nextUrl.searchParams);
  // Drizzle errors may contain query parameters (including personal search terms).
  const result = await searchRecords(getDb(), user.id, input).catch(() => {
    throw new Error("기록 검색에 실패했습니다.");
  });
  return NextResponse.json(result, {
    headers: { "Cache-Control": "private, no-store" },
  });
});
