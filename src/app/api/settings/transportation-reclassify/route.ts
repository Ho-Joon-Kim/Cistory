import { type NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import {
  reclassifyTransportationRange,
  TransportationReclassificationError,
  TransportationReclassificationValidationError,
} from "@/modules/location/services/transportation/reclassify";

export async function POST(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "유효하지 않은 JSON 본문입니다" }, { status: 400 });
  }

  const { from, to } = (body ?? {}) as { from?: unknown; to?: unknown };
  if (typeof from !== "string" || typeof to !== "string") {
    return NextResponse.json(
      { error: "from/to 파라미터가 필요합니다 (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  try {
    const summary = await reclassifyTransportationRange(user.id, from, to);
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    if (error instanceof TransportationReclassificationValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof TransportationReclassificationError) {
      logger.error("transportation reclassification failed", {
        userId: user.id,
        failedDate: error.failedDate,
        daysProcessed: error.daysProcessed,
        error: error.message,
      });
      return NextResponse.json(
        {
          error: `${error.failedDate} 재분류에 실패했습니다`,
          failedDate: error.failedDate,
          daysProcessed: error.daysProcessed,
          trackCount: error.trackCount,
          segmentCount: error.segmentCount,
        },
        { status: 500 }
      );
    }

    logger.error("transportation reclassification failed", {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "교통수단 재분류에 실패했습니다" }, { status: 500 });
  }
}
