/**
 * Scratch Map API Route
 *
 * GET /api/reports/scratch-map → 전체 방문 지역 집계
 * GET /api/reports/scratch-map?year=2026 → 특정 연도 방문 지역
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { getDb, locationPoints, placeCache } from "@/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";

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

    // Build address lookup from placeCache
    const addressMap = new Map<string, string>();
    if (cells.length > 0) {
      const placeResults = await db
        .select({
          latKey: placeCache.latKey,
          lonKey: placeCache.lonKey,
          address: placeCache.address,
        })
        .from(placeCache);

      for (const p of placeResults) {
        if (p.address) {
          addressMap.set(`${p.latKey.toFixed(4)}:${p.lonKey.toFixed(4)}`, p.address);
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

      const address = findNearestAddress(addressMap, lat, lon);
      const regionName = extractRegion(address) || `${lat.toFixed(2)}, ${lon.toFixed(2)}`;

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
    console.error("Scratch map error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다" }, { status: 500 });
  }
}

function findNearestAddress(
  addressMap: Map<string, string>,
  lat: number,
  lon: number
): string | null {
  // Try nearby keys within ~0.01 degree of the cell center
  // placeCache uses latKey/lonKey rounded to 4 decimal places
  for (let dLat = -0.005; dLat <= 0.005; dLat += 0.001) {
    for (let dLon = -0.005; dLon <= 0.005; dLon += 0.001) {
      const tryKey = `${(lat + dLat).toFixed(4)}:${(lon + dLon).toFixed(4)}`;
      const addr = addressMap.get(tryKey);
      if (addr) return addr;
    }
  }
  return null;
}

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
