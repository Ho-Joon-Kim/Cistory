/**
 * Trip Detail API
 *
 * GET    /api/trips/:id  — Trip details
 * PUT    /api/trips/:id  — Update trip
 * DELETE /api/trips/:id  — Delete trip
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { getDb, trips } from "@/db";
import { eq, and } from "drizzle-orm";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const { id } = await context.params;
    const db = getDb();

    const [trip] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.id, id), eq(trips.userId, user.id)));

    if (!trip) {
      return NextResponse.json(
        { error: "여행을 찾을 수 없습니다" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      trip: {
        ...trip,
        visitedCities: trip.visitedCities ? JSON.parse(trip.visitedCities) : [],
        visitedCountries: trip.visitedCountries
          ? JSON.parse(trip.visitedCountries)
          : [],
      },
    });
  } catch (error) {
    console.error("Trip GET error:", error);
    return NextResponse.json(
      { error: "여행 조회에 실패했습니다" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const { id } = await context.params;
    const body = await request.json();
    const db = getDb();

    const [updated] = await db
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

    if (!updated) {
      return NextResponse.json(
        { error: "여행을 찾을 수 없습니다" },
        { status: 404 },
      );
    }

    return NextResponse.json({ trip: updated });
  } catch (error) {
    console.error("Trip PUT error:", error);
    return NextResponse.json(
      { error: "여행 수정에 실패했습니다" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const { id } = await context.params;
    const db = getDb();

    const result = await db
      .delete(trips)
      .where(and(eq(trips.id, id), eq(trips.userId, user.id)));

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "여행을 찾을 수 없습니다" },
        { status: 404 },
      );
    }

    return NextResponse.json({ message: "여행이 삭제되었습니다" });
  } catch (error) {
    console.error("Trip DELETE error:", error);
    return NextResponse.json(
      { error: "여행 삭제에 실패했습니다" },
      { status: 500 },
    );
  }
}
