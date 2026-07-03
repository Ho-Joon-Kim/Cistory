/**
 * Public subway overlay data
 *
 * GET /api/map/subway?bbox=west,south,east,north
 * Returns GeoJSON FeatureCollections for subway lines and stations that
 * intersect the requested bbox. No auth — this is reference data shared
 * across all users, sourced from OpenStreetMap via the Overpass cron — but
 * it does pass through the shared ingestion rate limiter since it is
 * reachable from the open internet.
 *
 * Query/GeoJSON assembly lives in src/modules/subway/service.ts
 * (getSubwayOverlay); this route only parses input and shapes the response.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { enforceRateLimit, logIngestionFailure } from "@/lib/api-auth";
import { logger } from "@/lib/logger";
import { getSubwayOverlay } from "@/modules/subway/service";

function parseBbox(raw: string | null): [number, number, number, number] | null {
  if (!raw) return null;
  const parts = raw.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 4) return null;
  if (parts.some((n) => !Number.isFinite(n))) return null;
  const [w, s, e, n] = parts;
  if (w >= e || s >= n) return null;
  if (w < -180 || e > 180 || s < -90 || n > 90) return null;
  return [w, s, e, n];
}

export async function GET(request: NextRequest) {
  try {
    const rate = enforceRateLimit(request, "map-subway");
    if (!rate.allowed) {
      logIngestionFailure("map-subway", "rate_limited", request);
      return NextResponse.json(
        { error: "요청이 너무 많습니다" },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
      );
    }

    const { searchParams } = new URL(request.url);
    const bbox = parseBbox(searchParams.get("bbox"));
    if (!bbox) {
      return NextResponse.json(
        { error: "bbox 파라미터가 필요합니다 (west,south,east,north)" },
        { status: 400 }
      );
    }

    const overlay = await getSubwayOverlay(bbox);

    return NextResponse.json(overlay, {
      headers: {
        // Public reference data; refreshed yearly by cron. Safe to cache
        // aggressively. `s-maxage` so CDNs (if any) also cache.
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    });
  } catch (err) {
    logger.error("Failed to fetch subway overlay", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "서버 오류가 발생했습니다" }, { status: 500 });
  }
}
