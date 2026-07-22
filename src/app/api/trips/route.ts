/**
 * Trips API
 *
 * GET  /api/trips?year=YYYY  — Legacy ascending list for a year
 * GET  /api/trips?limit=N&cursor=... — Recent trips, cursor-paginated
 * POST /api/trips            — Create a manual trip
 */

import { and, asc, eq, gte, lt } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb, trips } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { withTripWriteLock } from "@/modules/location/services/trip-writer";
import {
  DEFAULT_TRIP_LIST_LIMIT,
  decodeTripCursor,
  MAX_TRIP_LIST_LIMIT,
  TravelService,
} from "@/modules/travel/service";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const params = request.nextUrl.searchParams;
    const yearParam = params.get("year");
    if (yearParam != null && !/^\d{4}$/.test(yearParam)) {
      return NextResponse.json({ error: "year 파라미터가 필요합니다 (YYYY)" }, { status: 400 });
    }

    const db = getDb();
    if (yearParam == null) {
      const requestedLimit = Number(params.get("limit"));
      const limit = Math.min(
        Number.isInteger(requestedLimit) && requestedLimit > 0
          ? requestedLimit
          : DEFAULT_TRIP_LIST_LIMIT,
        MAX_TRIP_LIST_LIMIT
      );
      const cursorParam = params.get("cursor");
      const cursor = cursorParam ? decodeTripCursor(cursorParam) : null;
      if (cursorParam && !cursor) {
        return NextResponse.json({ error: "잘못된 cursor입니다" }, { status: 400 });
      }

      const result = await new TravelService(db).listTrips(user.id, { limit, cursor });
      return NextResponse.json(result);
    }

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
    logger.error("Trips GET error", {
      error: error instanceof Error ? error.message : String(error),
    });
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

    const now = new Date();
    const created = await withTripWriteLock(user.id, async (tx) => {
      const [row] = await tx
        .insert(trips)
        .values({
          userId: user.id,
          name,
          startDate,
          endDate,
          notes: notes ?? null,
          isOverseas: false,
          autoDetected: false,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return row;
    });

    return NextResponse.json({ trip: created }, { status: 201 });
  } catch (error) {
    logger.error("Trips POST error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "여행 생성에 실패했습니다" }, { status: 500 });
  }
}
