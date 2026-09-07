import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { ApiError, withAuth } from "@/lib/api-handler";
import { dateKeyToUtcMillis, shiftDateKey, toKstCalendarDate } from "@/lib/date-key";
import { getDataStatus } from "@/modules/data-status/service";
export const GET = withAuth(async ({ user, request }) => {
  const params = new URL(request.url).searchParams;
  const to = params.get("to") ?? toKstCalendarDate(new Date());
  if (dateKeyToUtcMillis(to) === null) throw new ApiError(400, "유효한 날짜를 선택해 주세요.");
  const from = params.get("from") ?? shiftDateKey(to, -29);
  return NextResponse.json(await getDataStatus(getDb(), user.id, from, to));
});
