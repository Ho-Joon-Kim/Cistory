/**
 * Trips API
 *
 * GET  /api/trips?year=YYYY  — List trips for a year
 * POST /api/trips            — Create a manual trip
 */

import { and, asc, eq, gte, lt } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb, trips } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const yearParam = request.nextUrl.searchParams.get("year");
    if (!yearParam || !/^\d{4}$/.test(yearParam)) {
      return NextResponse.json({ error: "year 파라미터가 필요합니다 (YYYY)" }, { status: 400 });
    }

    const db = getDb();
    const rows = await db
      .select()
      .from(trips)
      .where(
        and(
          eq(trips.userId, user.id),
          gte(trips.startDate, `${yearParam}-01-01`),
          lt(trips.startDate, `${Number(yearParam) + 1}-01-01`)
        )
      )
      .orderBy(asc(trips.startDate));

    return NextResponse.json({
      trips: rows.map((t) => ({
        ...t,
        visitedCities: t.visitedCities ? JSON.parse(t.visitedCities) : [],
        visitedCountries: t.visitedCountries ? JSON.parse(t.visitedCountries) : [],
      })),
    });
  } catch (error) {
    console.error("Trips GET error:", error);
    return NextResponse.json({ error: "여행 목록 조회에 실패했습니다" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const body = await request.json();
    const { name, startDate, endDate, notes } = body;

    if (!name || !startDate || !endDate) {
      return NextResponse.json({ error: "name, startDate, endDate는 필수입니다" }, { status: 400 });
    }

    const db = getDb();
    const now = new Date();

    const [created] = await db
      .insert(trips)
      .values({
        userId: user.id,
        name,
        startDate,
        endDate,
        notes: notes ?? null,
        isOverseas: false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return NextResponse.json({ trip: created }, { status: 201 });
  } catch (error) {
    console.error("Trips POST error:", error);
    return NextResponse.json({ error: "여행 생성에 실패했습니다" }, { status: 500 });
  }
}
