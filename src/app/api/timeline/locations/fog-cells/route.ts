/**
 * Fog of War Cells API
 *
 * GET /api/timeline/locations/fog-cells
 * Returns all visited ~1km grid cells for the authenticated user.
 *
 * P7: reads from the pre-aggregated \`fog_cells_cache\` table (refreshed by the
 * daily location cron). Previously this endpoint did a GROUP BY over the entire
 * locationPoints table on every request — for a user with 1M+ points that's a
 * multi-second full scan on each map load.
 *
 * Fallback: if the cache is empty (e.g. cron hasn't run yet, or the user just
 * signed up), we fall back to the live aggregate so the map isn't blank.
 */

import { eq, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fogCellsCache, getDb, locationPoints } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const db = getDb();

    const cached = await db
      .select({ lat: fogCellsCache.lat, lon: fogCellsCache.lon })
      .from(fogCellsCache)
      .where(eq(fogCellsCache.userId, user.id));

    let cells = cached.map((r) => ({ lat: Number(r.lat), lon: Number(r.lon) }));

    // Live fallback when the cache hasn't been populated yet.
    if (cells.length === 0) {
      const live = await db
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
      cells = live.map((r) => ({ lat: Number(r.cellLat), lon: Number(r.cellLon) }));
    }

    return NextResponse.json(
      { cells },
      {
        headers: {
          // Safe to cache per-user for an hour; the daily cron refreshes the
          // backing table and the UI doesn't change more than once per day.
          "Cache-Control": "private, max-age=3600",
        },
      }
    );
  } catch (err) {
    console.error("Failed to fetch fog cells:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다" }, { status: 500 });
  }
}
