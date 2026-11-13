/**
 * Trips API
 *
 * GET  /api/trips?year=YYYY  — Legacy ascending list for a year
 * GET  /api/trips?limit=N&cursor=... — Recent trips, cursor-paginated
 *      &summary=1 adds `summary`: every trip of the current KST year plus the
 *      first Toss transaction date (the /travel hero)
 * POST /api/trips            — Create a manual trip
 */

import { and, asc, eq, gte, lt } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb, trips } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { toKstCalendarDate } from "@/lib/date-key";
import { logger } from "@/lib/logger";
import {
  createManualTrip,
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
      return NextResponse.json({ error: "year 파라미터가 필요해요 (YYYY)" }, { status: 400 });
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
        return NextResponse.json({ error: "잘못된 cursor예요" }, { status: 400 });
      }

      const service = new TravelService(db);
      if (params.get("summary") === "1") {
        const year = Number(toKstCalendarDate(new Date()).slice(0, 4));
        const [result, summary] = await Promise.all([
          service.listTrips(user.id, { limit, cursor }),
          service.getListSummary(user.id, year),
        ]);
        return NextResponse.json({ ...result, summary });
      }
      const result = await service.listTrips(user.id, { limit, cursor });
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
    return NextResponse.json(
      { error: "여행 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const body = await request.json();
    const { name, startDate, endDate, notes } = body;

    if (!name || !startDate || !endDate) {
      return NextResponse.json({ error: "name, startDate, endDate는 필수예요" }, { status: 400 });
    }

    const created = await createManualTrip(user.id, { name, startDate, endDate, notes });

    return NextResponse.json({ trip: created }, { status: 201 });
  } catch (error) {
    logger.error("Trips POST error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "여행을 만들지 못했어요. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
