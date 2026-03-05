import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { getDb, savedPlaces } from "@/db";
import { and, eq } from "drizzle-orm";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const { id } = await params;
    const body = await request.json();
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.length < 1 || body.name.length > 100) {
        return NextResponse.json(
          { error: "이름은 1~100자 사이여야 합니다" },
          { status: 400 },
        );
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
    if (body.icon !== undefined) updates.icon = body.icon || null;
    if (body.color !== undefined) updates.color = body.color || null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "수정할 항목이 없습니다" },
        { status: 400 },
      );
    }

    updates.updatedAt = new Date();

    const db = getDb();
    const [place] = await db
      .update(savedPlaces)
      .set(updates)
      .where(and(eq(savedPlaces.id, id), eq(savedPlaces.userId, user.id)))
      .returning();

    if (!place) {
      return NextResponse.json(
        { error: "장소를 찾을 수 없습니다" },
        { status: 404 },
      );
    }

    return NextResponse.json({ place });
  } catch (error) {
    console.error("Saved places PUT error:", error);
    return NextResponse.json(
      { error: "장소 수정에 실패했습니다" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const { id } = await params;
    const db = getDb();

    const [deleted] = await db
      .delete(savedPlaces)
      .where(and(eq(savedPlaces.id, id), eq(savedPlaces.userId, user.id)))
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { error: "장소를 찾을 수 없습니다" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Saved places DELETE error:", error);
    return NextResponse.json(
      { error: "장소 삭제에 실패했습니다" },
      { status: 500 },
    );
  }
}
