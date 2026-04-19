/**
 * Fog of War Cells API
 *
 * GET /api/timeline/locations/fog-cells
 * Returns all visited ~1km grid cells for the authenticated user.
 * Used by the Fog of War map overlay to reveal visited areas.
 */

import { eq, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { locationPoints } from "@/db/schema";
import { getAuthenticatedUser } from "@/lib/auth-helpers";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const db = getDb();

    // Aggregate location points into ~1km grid cells
    // ROUND(lat * 100) / 100 gives ~1.11km resolution at equator
    const result = await db
      .select({
        cellLat: sql<number>`ROUND(${locationPoints.lat}::numeric * 100) / 100`,
        cellLon: sql<number>`ROUND(${locationPoints.lon}::numeric * 100) / 100`,
      })
      .from(locationPoints)
      .where(eq(locationPoints.userId, user.id))
      .groupBy(
        sql`ROUND(${locationPoints.lat}::numeric * 100) / 100`,
        sql`ROUND(${locationPoints.lon}::numeric * 100) / 100`
      );

    return NextResponse.json({
      cells: result.map((r) => ({ lat: Number(r.cellLat), lon: Number(r.cellLon) })),
    });
  } catch (err) {
    console.error("Failed to fetch fog cells:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다" }, { status: 500 });
  }
}
