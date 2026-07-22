import { type NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { isValidTripDateRange, regenerateTrips } from "@/modules/location/services/trip-detector";

const TRIP_HISTORY_START = "2025-03-08";

export async function POST(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "유효하지 않은 JSON 본문입니다" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "유효하지 않은 요청 본문입니다" }, { status: 400 });
  }
  const input = body as { from?: unknown; to?: unknown };
  if (
    (input.from !== undefined && typeof input.from !== "string") ||
    (input.to !== undefined && typeof input.to !== "string")
  ) {
    return NextResponse.json({ error: "from/to는 YYYY-MM-DD 형식이어야 합니다" }, { status: 400 });
  }

  const from = (input.from as string | undefined) ?? TRIP_HISTORY_START;
  const to =
    (input.to as string | undefined) ??
    new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (!isValidTripDateRange(from, to)) {
    return NextResponse.json({ error: "유효하지 않은 날짜 범위입니다" }, { status: 400 });
  }

  try {
    const summary = await regenerateTrips(user.id, from, to);
    return NextResponse.json({ ok: true, from, to, ...summary });
  } catch (error) {
    logger.error("trip regeneration failed", {
      userId: user.id,
      from,
      to,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "여행 재생성에 실패했습니다" }, { status: 500 });
  }
}
