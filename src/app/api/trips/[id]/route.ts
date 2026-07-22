/**
 * Trip Detail API
 *
 * GET    /api/trips/:id  — Trip details
 * PUT    /api/trips/:id  — Update trip
 * DELETE /api/trips/:id  — Delete trip
 */

import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb, trips } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { withTripWriteLock } from "@/modules/location/services/trip-writer";
import { TravelService } from "@/modules/travel/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const { id } = await context.params;
    const detail = await new TravelService(getDb()).getTripDetail(user.id, id);
    if (!detail) {
      return NextResponse.json({ error: "여행을 찾을 수 없습니다" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    logger.error("Trip GET error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "여행 조회에 실패했습니다" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const { id } = await context.params;
    const body = await request.json();
    const updated = await withTripWriteLock(user.id, async (tx) => {
      const [existing] = await tx
        .select({ id: trips.id })
        .from(trips)
        .where(and(eq(trips.id, id), eq(trips.userId, user.id)));
      if (!existing) return null;

      const [row] = await tx
        .update(trips)
        .set({
          ...(body.name != null ? { name: body.name } : {}),
          ...(body.startDate != null ? { startDate: body.startDate } : {}),
          ...(body.endDate != null ? { endDate: body.endDate } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(trips.id, id), eq(trips.userId, user.id)))
        .returning();
      return row ?? null;
    });

    if (!updated) {
      return NextResponse.json({ error: "여행을 찾을 수 없습니다" }, { status: 404 });
    }

    return NextResponse.json({ trip: updated });
  } catch (error) {
    logger.error("Trip PUT error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "여행 수정에 실패했습니다" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const { id } = await context.params;
    const deleted = await withTripWriteLock(user.id, async (tx) => {
      const [existing] = await tx
        .select({ id: trips.id })
        .from(trips)
        .where(and(eq(trips.id, id), eq(trips.userId, user.id)));
      if (!existing) return false;
      await tx.delete(trips).where(and(eq(trips.id, id), eq(trips.userId, user.id)));
      return true;
    });

    if (!deleted) {
      return NextResponse.json({ error: "여행을 찾을 수 없습니다" }, { status: 404 });
    }

    return NextResponse.json({ message: "여행이 삭제되었습니다" });
  } catch (error) {
    logger.error("Trip DELETE error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "여행 삭제에 실패했습니다" }, { status: 500 });
  }
}
