/**
 * Tracks API
 *
 * GET  /api/timeline/locations/tracks?date=YYYY-MM-DD — Fetch tracks with embedded segments
 * POST /api/timeline/locations/tracks?date=YYYY-MM-DD — Trigger track recalculation
 */

import { type NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { getDayTracks } from "@/modules/location/queries";
import { detectAndPersistTracks } from "@/modules/location/services/track-persister";

function parseDateParam(request: NextRequest) {
  const dateParam = request.nextUrl.searchParams.get("date");
  if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return { error: "date 파라미터가 필요합니다 (YYYY-MM-DD)" };
  }
  return { dateParam };
}

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const parsed = parseDateParam(request);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const result = await getDayTracks(user.id, parsed.dateParam);

    return NextResponse.json({ tracks: result });
  } catch (error) {
    logger.error("Tracks GET error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "이동 경로를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const parsed = parseDateParam(request);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const result = await detectAndPersistTracks(user.id, parsed.dateParam);

    return NextResponse.json({
      message: `${result.trackCount}개 트랙, ${result.segmentCount}개 세그먼트 생성`,
      ...result,
    });
  } catch (error) {
    logger.error("Tracks POST error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "이동 경로를 만들지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
