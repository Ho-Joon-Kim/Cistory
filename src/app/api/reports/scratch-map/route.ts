/**
 * Scratch Map API Route
 *
 * GET /api/reports/scratch-map → 전체 방문 지역 집계
 * GET /api/reports/scratch-map?year=2026 → 특정 연도 방문 지역
 */

import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, locationPoints, placeCache } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const year = request.nextUrl.searchParams.get("year");

    const db = getDb();

    // Get distinct visited grid cells (~1km resolution) with counts
    const whereConditions = year
      ? and(
          eq(locationPoints.userId, user.id),
          gte(locationPoints.timestamp, new Date(Number(year), 0, 1)),
          lte(locationPoints.timestamp, new Date(Number(year), 11, 31, 23, 59, 59))
        )
      : eq(locationPoints.userId, user.id);

    const cells = await db
      .select({
        cellLat: sql<number>`ROUND(${locationPoints.lat}::numeric * 100) / 100`,
        cellLon: sql<number>`ROUND(${locationPoints.lon}::numeric * 100) / 100`,
        pointCount: sql<number>`COUNT(*)::int`,
        firstVisit: sql<string>`MIN(${locationPoints.timestamp})::text`,
        lastVisit: sql<string>`MAX(${locationPoints.timestamp})::text`,
      })
      .from(locationPoints)
      .where(whereConditions)
      .groupBy(
        sql`ROUND(${locationPoints.lat}::numeric * 100) / 100`,
        sql`ROUND(${locationPoints.lon}::numeric * 100) / 100`
      );

    // P3: bbox-bounded placeCache lookup instead of full table scan.
    const placeMap = new Map<string, { address: string | null; region: string | null }>();
    if (cells.length > 0) {
      let minLat = Number.POSITIVE_INFINITY;
      let maxLat = Number.NEGATIVE_INFINITY;
      let minLon = Number.POSITIVE_INFINITY;
      let maxLon = Number.NEGATIVE_INFINITY;
      for (const cell of cells) {
        const lat = Number(cell.cellLat);
        const lon = Number(cell.cellLon);
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
      }
      const margin = 0.05; // ~5km — ample for findNearestPlace's 0.05 step

      const placeResults = await db
        .select({
          latKey: placeCache.latKey,
          lonKey: placeCache.lonKey,
          address: placeCache.address,
          region: placeCache.region,
        })
        .from(placeCache)
        .where(
          and(
            gte(placeCache.latKey, minLat - margin),
            lte(placeCache.latKey, maxLat + margin),
            gte(placeCache.lonKey, minLon - margin),
            lte(placeCache.lonKey, maxLon + margin)
          )
        );

      for (const p of placeResults) {
        if (p.address || p.region) {
          placeMap.set(`${p.latKey.toFixed(4)}:${p.lonKey.toFixed(4)}`, {
            address: p.address,
            region: p.region,
          });
        }
      }
    }

    // Extract 시군구 from addresses and aggregate by region
    const regionMap = new Map<
      string,
      {
        name: string;
        visits: number;
        firstVisit: string;
        lastVisit: string;
        lat: number;
        lon: number;
      }
    >();

    for (const cell of cells) {
      // SQL ROUND() may return string via numeric type — ensure numbers
      const lat = Number(cell.cellLat);
      const lon = Number(cell.cellLon);
      const visits = Number(cell.pointCount);

      const place = findNearestPlace(placeMap, lat, lon);
      // place_cache.region now holds the real 시/도 from the geocoding
      // adapters' structured fields. Fall back to splitting the cached
      // address only when region hasn't been backfilled for that row yet,
      // so an unpopulated row still degrades gracefully instead of losing
      // its label outright.
      const regionName =
        place?.region ||
        extractRegion(place?.address ?? null) ||
        `${lat.toFixed(2)}, ${lon.toFixed(2)}`;

      const existing = regionMap.get(regionName);
      if (existing) {
        existing.visits += visits;
        if (cell.firstVisit < existing.firstVisit) existing.firstVisit = cell.firstVisit;
        if (cell.lastVisit > existing.lastVisit) existing.lastVisit = cell.lastVisit;
      } else {
        regionMap.set(regionName, {
          name: regionName,
          visits,
          firstVisit: cell.firstVisit,
          lastVisit: cell.lastVisit,
          lat,
          lon,
        });
      }
    }

    const regions = Array.from(regionMap.values()).sort((a, b) => b.visits - a.visits);

    return NextResponse.json({
      regions,
      totalCells: cells.length,
      totalRegions: regions.length,
    });
  } catch (err) {
    logger.error("Scratch map error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "서버 오류가 발생했습니다" }, { status: 500 });
  }
}

function findNearestPlace(
  placeMap: Map<string, { address: string | null; region: string | null }>,
  lat: number,
  lon: number
): { address: string | null; region: string | null } | null {
  // Try nearby keys within ~0.01 degree of the cell center
  // placeCache uses latKey/lonKey rounded to 4 decimal places
  for (let dLat = -0.005; dLat <= 0.005; dLat += 0.001) {
    for (let dLon = -0.005; dLon <= 0.005; dLon += 0.001) {
      const tryKey = `${(lat + dLat).toFixed(4)}:${(lon + dLon).toFixed(4)}`;
      const place = placeMap.get(tryKey);
      if (place) return place;
    }
  }
  return null;
}

/**
 * Fallback only: splits the cached address string into a 시도+시군구 label
 * for `place_cache` rows whose `region` column hasn't been backfilled.
 * `place_cache.region` is the real 시/도 and should be preferred wherever
 * it's populated — see the call site.
 */
function extractRegion(address: string | null): string | null {
  if (!address) return null;
  // Korean address format: "서울특별시 강남구 ..." or "경기도 성남시 분당구 ..."
  const parts = address.split(" ");
  if (parts.length >= 2) {
    // Return 시도 + 시군구
    return parts.slice(0, 2).join(" ");
  }
  return parts[0] || null;
}
