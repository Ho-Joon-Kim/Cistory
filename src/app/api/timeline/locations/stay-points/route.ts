/**
 * Stay Points Detection API
 *
 * GET /api/timeline/locations/stay-points?date=YYYY-MM-DD
 *
 * 10분 이상 머문 장소를 자동 감지하고,
 * 국내는 Kakao Local API / 국외는 Mapbox Reverse Geocoding으로 장소명을 resolve.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers";
import { getDb, locationPoints, placeCache, savedPlaces } from "@/db";
import { eq, and, gte, lt, lte, asc, or, isNull } from "drizzle-orm";
import { getGeocodingAdapter } from "@/lib/adapters/geocoding";
import { distanceM } from "@/lib/geo";
import type { SavedPlace } from "@/db";

const STAY_RADIUS_M = 100; // 같은 클러스터로 판정할 반경 (미터)
const MIN_STAY_MINUTES = 10; // 최소 머문 시간 (분)
const TIME_GAP_MINUTES = 10; // 다음 포인트까지 이 시간 이상 비면 → 해당 위치에 머문 것으로 추정

interface LocationRow {
  lat: number;
  lon: number;
  timestamp: Date;
}

interface StayCluster {
  points: LocationRow[];
  centroidLat: number;
  centroidLon: number;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
}

/**
 * Stay point detection
 *
 * 전략:
 * 1. 연속된 포인트가 반경 100m 내 → 같은 클러스터로 묶기
 * 2. 포인트가 1개뿐이어도, 다음 포인트까지 시간 간격이 10분 이상이면
 *    → 해당 위치에 머문 것으로 추정 (OwnTracks가 정지 시 포인트를 드물게 보내는 문제 대응)
 */
function detectStayPoints(rows: LocationRow[]): StayCluster[] {
  if (rows.length === 0) return [];

  const clusters: StayCluster[] = [];
  let currentCluster: LocationRow[] = [rows[0]];
  function tryFinishCluster(nextRow: LocationRow | null) {
    const start = currentCluster[0].timestamp;
    const lastPoint = currentCluster[currentCluster.length - 1];
    const centroidLat = currentCluster.reduce((s, p) => s + p.lat, 0) / currentCluster.length;
    const centroidLon = currentCluster.reduce((s, p) => s + p.lon, 0) / currentCluster.length;

    let endTime = lastPoint.timestamp;

    if (nextRow) {
      const gapToNextMin =
        (nextRow.timestamp.getTime() - lastPoint.timestamp.getTime()) / 60_000;

      if (currentCluster.length === 1 && gapToNextMin >= TIME_GAP_MINUTES) {
        endTime = nextRow.timestamp;
      }
    }

    const durationMinutes = (endTime.getTime() - start.getTime()) / 60_000;

    if (durationMinutes >= MIN_STAY_MINUTES) {
      clusters.push({
        points: currentCluster,
        centroidLat,
        centroidLon,
        startTime: start,
        endTime,
        durationMinutes: Math.round(durationMinutes),
      });
    }
  }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const centroidLat = currentCluster.reduce((s, p) => s + p.lat, 0) / currentCluster.length;
    const centroidLon = currentCluster.reduce((s, p) => s + p.lon, 0) / currentCluster.length;

    if (distanceM(centroidLat, centroidLon, row.lat, row.lon) <= STAY_RADIUS_M) {
      currentCluster.push(row);
    } else {
      tryFinishCluster(row);
      currentCluster = [row];
    }
  }

  tryFinishCluster(null);

  return clusters;
}

/** 좌표를 소수점 3자리로 반올림 (~111m 단위 캐시 키) */
function roundCoord(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const dateParam = request.nextUrl.searchParams.get("date");
    if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return NextResponse.json(
        { error: "date 파라미터가 필요합니다 (YYYY-MM-DD)" },
        { status: 400 },
      );
    }

    const db = getDb();
    const dayStart = new Date(`${dateParam}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateParam}T23:59:59.999Z`);

    // 1. 해당 날짜의 location points 조회 (정확도 200m 이하)
    const rows = await db
      .select({
        lat: locationPoints.lat,
        lon: locationPoints.lon,
        timestamp: locationPoints.timestamp,
      })
      .from(locationPoints)
      .where(
        and(
          eq(locationPoints.userId, user.id),
          gte(locationPoints.timestamp, dayStart),
          lt(locationPoints.timestamp, dayEnd),
          or(isNull(locationPoints.accuracy), lte(locationPoints.accuracy, 200)),
        ),
      )
      .orderBy(asc(locationPoints.timestamp));

    // 2. Stay point 알고리즘 적용
    const clusters = detectStayPoints(rows);

    // 3. 유저 저장 장소 조회 (geocoding 우선 매칭용)
    const userSavedPlaces: SavedPlace[] = await db
      .select()
      .from(savedPlaces)
      .where(eq(savedPlaces.userId, user.id));

    // 4. 각 stay point에 대해 저장 장소 매칭 → 캐시 → geocoding 순차 처리
    const stayPoints = [];
    for (const cluster of clusters) {
      // 저장 장소 매칭 (geocoding/캐시 건너뛰기)
      const matched = userSavedPlaces.find(
        (p) => distanceM(cluster.centroidLat, cluster.centroidLon, p.lat, p.lon) <= p.radiusM,
      );
      if (matched) {
        stayPoints.push({
          lat: cluster.centroidLat,
          lon: cluster.centroidLon,
          placeName: matched.name,
          address: matched.address,
          category: matched.category,
          savedPlaceId: matched.id,
          icon: matched.icon,
          color: matched.color,
          startTime: cluster.startTime.toISOString(),
          endTime: cluster.endTime.toISOString(),
          durationMinutes: cluster.durationMinutes,
        });
        continue;
      }

      const latKey = roundCoord(cluster.centroidLat);
      const lonKey = roundCoord(cluster.centroidLon);

      // 캐시 확인
      const cached = await db
        .select()
        .from(placeCache)
        .where(and(eq(placeCache.latKey, latKey), eq(placeCache.lonKey, lonKey)))
        .limit(1);

      if (cached.length > 0) {
        const c = cached[0];
        // placeName === address이고 category가 없으면 POI 미검출 stale 캐시 → 삭제 후 재검색
        const isStale = c.placeName === c.address && !c.category;
        if (isStale) {
          await db
            .delete(placeCache)
            .where(and(eq(placeCache.latKey, latKey), eq(placeCache.lonKey, lonKey)));
        } else {
          stayPoints.push({
            lat: cluster.centroidLat,
            lon: cluster.centroidLon,
            placeName: c.placeName,
            address: c.address,
            category: c.category,
            startTime: cluster.startTime.toISOString(),
            endTime: cluster.endTime.toISOString(),
            durationMinutes: cluster.durationMinutes,
          });
          continue;
        }
      }

      // 캐시 miss → geocoding
      try {
        const adapter = getGeocodingAdapter(cluster.centroidLat, cluster.centroidLon);
        const result = await adapter.reverseGeocode(cluster.centroidLat, cluster.centroidLon);

        if (result) {
          // 캐시 저장
          await db
            .insert(placeCache)
            .values({
              latKey,
              lonKey,
              placeName: result.placeName,
              address: result.address,
              category: result.category ?? null,
              provider: result.provider,
              resolvedAt: new Date(),
            })
            .onConflictDoNothing();

          stayPoints.push({
            lat: cluster.centroidLat,
            lon: cluster.centroidLon,
            placeName: result.placeName,
            address: result.address,
            category: result.category,
            startTime: cluster.startTime.toISOString(),
            endTime: cluster.endTime.toISOString(),
            durationMinutes: cluster.durationMinutes,
          });
          continue;
        }
      } catch (e) {
        console.error("Geocoding error:", e);
      }

      // geocoding 실패 시 좌표만 반환
      stayPoints.push({
        lat: cluster.centroidLat,
        lon: cluster.centroidLon,
        placeName: null,
        address: null,
        category: null,
        startTime: cluster.startTime.toISOString(),
        endTime: cluster.endTime.toISOString(),
        durationMinutes: cluster.durationMinutes,
      });
    }

    return NextResponse.json({ stayPoints });
  } catch (error) {
    console.error("Stay points error:", error);
    return NextResponse.json(
      { error: "Stay point 조회에 실패했습니다" },
      { status: 500 },
    );
  }
}
