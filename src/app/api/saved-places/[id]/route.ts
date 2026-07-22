import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { savedPlaces } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { withTripWriteLock } from "@/modules/location/services/trip-writer";

function parseBasicPlaceUpdates(body: Record<string, unknown>) {
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.length < 1 || body.name.length > 100) {
      return { error: "이름은 1~100자 사이여야 합니다" };
    }
    updates.name = body.name.trim();
  }
  if (typeof body.lat === "number") updates.lat = body.lat;
  if (typeof body.lon === "number") updates.lon = body.lon;
  if (typeof body.radiusM === "number") {
    updates.radiusM = Math.min(500, Math.max(50, body.radiusM));
  }
  if (body.category !== undefined) updates.category = body.category || null;
  if (body.address !== undefined) updates.address = body.address || null;
  return { updates };
}

function parseTripExclusionUpdates(body: Record<string, unknown>) {
  const updates: Record<string, unknown> = {};
  if (body.excludeFromTrips !== undefined) {
    if (typeof body.excludeFromTrips !== "boolean") {
      return { error: "여행 감지 제외 여부는 boolean이어야 합니다" };
    }
    updates.excludeFromTrips = body.excludeFromTrips;
  }
  if (body.tripExclusionRadiusM !== undefined) {
    if (
      body.tripExclusionRadiusM !== null &&
      (!Number.isInteger(body.tripExclusionRadiusM) ||
        (body.tripExclusionRadiusM as number) < 1_000 ||
        (body.tripExclusionRadiusM as number) > 100_000)
    ) {
      return { error: "여행 제외 반경은 1,000~100,000m 사이여야 합니다" };
    }
    updates.tripExclusionRadiusM = body.tripExclusionRadiusM;
  }
  return { updates };
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const basic = parseBasicPlaceUpdates(body);
    if ("error" in basic) {
      return NextResponse.json({ error: basic.error }, { status: 400 });
    }
    const exclusion = parseTripExclusionUpdates(body);
    if ("error" in exclusion) {
      return NextResponse.json({ error: exclusion.error }, { status: 400 });
    }
    const updates = { ...basic.updates, ...exclusion.updates };

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "수정할 항목이 없습니다" }, { status: 400 });
    }

    updates.updatedAt = new Date();

    const place = await withTripWriteLock(user.id, async (tx) => {
      const [updated] = await tx
        .update(savedPlaces)
        .set(updates)
        .where(and(eq(savedPlaces.id, id), eq(savedPlaces.userId, user.id)))
        .returning();
      return updated ?? null;
    });

    if (!place) {
      return NextResponse.json({ error: "장소를 찾을 수 없습니다" }, { status: 404 });
    }

    return NextResponse.json({ place });
  } catch (error) {
    logger.error("Saved places PUT error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "장소 수정에 실패했습니다" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const { id } = await params;
    const deleted = await withTripWriteLock(user.id, async (tx) => {
      const [row] = await tx
        .delete(savedPlaces)
        .where(and(eq(savedPlaces.id, id), eq(savedPlaces.userId, user.id)))
        .returning();
      return row ?? null;
    });

    if (!deleted) {
      return NextResponse.json({ error: "장소를 찾을 수 없습니다" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Saved places DELETE error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "장소 삭제에 실패했습니다" }, { status: 500 });
  }
}
