import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers";
import { getDb, savedPlaces } from "@/db";
import { eq, desc } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const db = getDb();
    const places = await db
      .select()
      .from(savedPlaces)
      .where(eq(savedPlaces.userId, user.id))
      .orderBy(desc(savedPlaces.updatedAt));

    return NextResponse.json({ places });
  } catch (error) {
    console.error("Saved places GET error:", error);
    return NextResponse.json(
      { error: "저장된 장소 조회에 실패했습니다" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const body = await request.json();
    const { name, lat, lon, radiusM, category, address, icon, color } = body;

    if (!name || typeof name !== "string" || name.length < 1 || name.length > 100) {
      return NextResponse.json(
        { error: "이름은 1~100자 사이여야 합니다" },
        { status: 400 },
      );
    }

    if (typeof lat !== "number" || typeof lon !== "number") {
      return NextResponse.json(
        { error: "위도와 경도가 필요합니다" },
        { status: 400 },
      );
    }

    const radius = typeof radiusM === "number" ? Math.min(500, Math.max(50, radiusM)) : 100;
    const now = new Date();

    const db = getDb();
    const [place] = await db
      .insert(savedPlaces)
      .values({
        userId: user.id,
        name: name.trim(),
        lat,
        lon,
        radiusM: radius,
        category: category || null,
        address: address || null,
        icon: icon || null,
        color: color || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return NextResponse.json({ place }, { status: 201 });
  } catch (error) {
    console.error("Saved places POST error:", error);
    return NextResponse.json(
      { error: "장소 저장에 실패했습니다" },
      { status: 500 },
    );
  }
}
