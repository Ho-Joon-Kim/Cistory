import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { shiftDateKey } from "@/lib/date-key";
import { logger } from "@/lib/logger";
import { invalidateRecoveredPeriods } from "@/modules/data-status/recovery";
import {
  reclassifyTransportationRange,
  TransportationReclassificationError,
  TransportationReclassificationValidationError,
} from "@/modules/location/services/transportation/reclassify";

/**
 * Transport modes feed the overview location domain (`transportModes`), and ended
 * periods never recompute on their own — mark every snapshot covering the rewritten
 * days pending so the precompute worker rebuilds them. Narratives are left alone
 * (regenerating them is an Opus call per period); the same choice the health webhook
 * makes. Best-effort: the reclassification itself already succeeded.
 */
async function invalidateOverview(userId: string, from: string, to: string): Promise<void> {
  try {
    await invalidateRecoveredPeriods(getDb(), userId, from, to, new Date(), { narratives: false });
  } catch (error) {
    logger.warn("transportation reclassification overview invalidation failed", {
      userId,
      from,
      to,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

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
    await invalidateOverview(user.id, from, to);
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    if (error instanceof TransportationReclassificationValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof TransportationReclassificationError) {
      // Each day is its own transaction, so the days before the failed one are rewritten.
      if (error.daysProcessed > 0) {
        await invalidateOverview(user.id, from, shiftDateKey(from, error.daysProcessed - 1));
      }
      logger.error("transportation reclassification failed", {
        userId: user.id,
        failedDate: error.failedDate,
        daysProcessed: error.daysProcessed,
        error: error.message,
      });
      return NextResponse.json(
        {
          error: `${error.failedDate}의 교통수단을 다시 판정하지 못했습니다. 잠시 후 다시 시도해 주세요.`,
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
    return NextResponse.json(
      { error: "교통수단을 다시 판정하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
