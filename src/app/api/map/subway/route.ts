/**
 * Public subway overlay data
 *
 * GET /api/map/subway?bbox=west,south,east,north
 * Returns GeoJSON FeatureCollections for subway lines and stations that
 * intersect the requested bbox. No auth — this is reference data shared
 * across all users, sourced from OpenStreetMap via the Overpass cron.
 *
 * Line colors are resolved server-side (OSM `colour` tag when available,
 * FNV-1a+golden-angle HSL fallback otherwise) so the client just reads
 * `properties.color`.
 */

import { sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { resolveLineColor } from "@/lib/subway-color";

interface LineRow {
  id: string;
  name: string | null;
  name_en: string | null;
  ref: string | null;
  colour: string | null;
  network: string | null;
  fallback_idx: number | string;
  geom: GeoJSON.MultiLineString;
}

interface StationRow {
  id: string;
  name: string | null;
  name_en: string | null;
  line_refs: unknown;
  lat: number | string;
  lon: number | string;
}

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
    const { searchParams } = new URL(request.url);
    const bbox = parseBbox(searchParams.get("bbox"));
    if (!bbox) {
      return NextResponse.json(
        { error: "bbox query param required, format: west,south,east,north" },
        { status: 400 }
      );
    }
    const [w, s, e, n] = bbox;
    const db = getDb();

    // Lines: assign a fallback_idx to colour-less lines within the same system so
    // our hash fallback can spread them via golden-angle. Lines with an OSM
    // `colour` tag get fallback_idx=0 (unused).
    const linesRes = await db.execute(sql`
      WITH numbered AS (
        SELECT id, system_id, name, name_en, ref, colour, network,
               CASE WHEN colour IS NULL
                    THEN (ROW_NUMBER() OVER (PARTITION BY system_id, (colour IS NULL)
                                              ORDER BY ref, name, id) - 1)
                    ELSE 0 END AS fallback_idx,
               ST_AsGeoJSON(geometry)::json AS geom
        FROM subway_lines
        WHERE ST_Intersects(
          geometry,
          ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)
        )
      )
      SELECT id, name, name_en, ref, colour, network, fallback_idx, geom FROM numbered
    `);

    const lineFeatures: GeoJSON.Feature[] = (linesRes.rows as unknown as LineRow[]).map((row) => ({
      type: "Feature",
      geometry: row.geom,
      properties: {
        id: row.id,
        name: row.name,
        nameEn: row.name_en,
        ref: row.ref,
        color: resolveLineColor({
          colour: row.colour,
          network: row.network,
          ref: row.ref,
          name: row.name,
          fallbackIndex: Number(row.fallback_idx) || 0,
        }),
      },
    }));

    const stationsRes = await db.execute(sql`
      SELECT id, name, name_en, line_refs,
             ST_X(location) AS lon, ST_Y(location) AS lat
      FROM subway_stations
      WHERE ST_Intersects(
        location,
        ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)
      )
    `);

    const stationFeatures: GeoJSON.Feature[] = (stationsRes.rows as unknown as StationRow[]).map(
      (row) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [Number(row.lon), Number(row.lat)],
        },
        properties: {
          id: row.id,
          name: row.name,
          nameEn: row.name_en,
          lineRefs: row.line_refs ?? [],
        },
      })
    );

    return NextResponse.json(
      {
        lines: { type: "FeatureCollection", features: lineFeatures },
        stations: { type: "FeatureCollection", features: stationFeatures },
      },
      {
        headers: {
          // Public reference data; refreshed yearly by cron. Safe to cache
          // aggressively. `s-maxage` so CDNs (if any) also cache.
          "Cache-Control": "public, max-age=86400, s-maxage=86400",
        },
      }
    );
  } catch (err) {
    console.error("Failed to fetch subway overlay:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다" }, { status: 500 });
  }
}
