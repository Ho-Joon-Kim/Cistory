/**
 * Detect cities a user visits that aren't covered by any existing
 * subway_systems entry, probe OSM for actual subway presence, and add the
 * city as a `source='discovered'` system. The next yearly cron / boot
 * catch-up then pulls the full data for it.
 *
 * Coverage check is done via PostGIS `ST_Contains(bbox, point)` against the
 * visit centroid. The country-wide `kr`/`jp`/`tw` seeds therefore subsume
 * every city in those countries — discovery only fires for places like
 * Bangkok, São Paulo, etc. where we have no seed at all.
 */

import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getOverpassAdapter } from "@/lib/adapters/overpass";
import { logger } from "@/lib/logger";

const PROBE_BBOX_DELTA_DEG = 0.1; // ~11 km half-width
const MIN_VISITS_PER_CITY = 2;
const MAX_NEW_CITIES_PER_RUN = 3;

interface CandidateCity {
  city: string;
  countryName: string | null;
  visitCount: number;
  lat: number;
  lon: number;
}

function slugifyCityKey(city: string, countryCode: string | null): string {
  const base = city
    .toLowerCase()
    .replace(/[^a-z0-9가-힣ぁ-んァ-ヶ一-龯々]/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const cc = (countryCode ?? "xx").toLowerCase();
  return `disc-${cc}-${base}`.slice(0, 60);
}

async function probeSubwayCount(
  bbox: [number, number, number, number]
): Promise<number> {
  const result = await getOverpassAdapter().fetchSubwayInBbox(bbox);
  return result.lines.length;
}

export async function discoverMissingSubwayCities(userId: string): Promise<void> {
  const db = getDb();

  // Find distinct cities this user has visited (with >=2 visits to avoid noise
  // from one-off geocoder hits). Aggregate centroid for the bbox probe.
  const candidates = await db.execute(sql`
    SELECT
      city,
      country_name        AS "countryName",
      COUNT(*)::int       AS "visitCount",
      AVG(center_lat)::float8 AS lat,
      AVG(center_lon)::float8 AS lon
    FROM visits
    WHERE user_id = ${userId}
      AND city IS NOT NULL
      AND length(trim(city)) > 0
    GROUP BY city, country_name
    HAVING COUNT(*) >= ${MIN_VISITS_PER_CITY}
    ORDER BY COUNT(*) DESC
  `);

  if (candidates.rows.length === 0) return;

  let added = 0;
  for (const row of candidates.rows as unknown as CandidateCity[]) {
    if (added >= MAX_NEW_CITIES_PER_RUN) break;
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon)) continue;

    // Skip if any existing subway_system bbox already contains this visit
    // centroid — country-wide seeds (kr/jp/tw) cover all their cities.
    const coverage = await db.execute(sql`
      SELECT 1
      FROM subway_systems
      WHERE ST_Contains(bbox, ST_SetSRID(ST_MakePoint(${row.lon}, ${row.lat}), 4326))
      LIMIT 1
    `);
    if (coverage.rows.length > 0) continue;

    const probeBbox: [number, number, number, number] = [
      row.lon - PROBE_BBOX_DELTA_DEG,
      row.lat - PROBE_BBOX_DELTA_DEG,
      row.lon + PROBE_BBOX_DELTA_DEG,
      row.lat + PROBE_BBOX_DELTA_DEG,
    ];

    let lineCount = 0;
    try {
      lineCount = await probeSubwayCount(probeBbox);
    } catch (err) {
      logger.warn("subway discovery probe failed, skipping city", {
        city: row.city,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (lineCount === 0) continue;

    const cityKey = slugifyCityKey(row.city, row.countryName);
    const cityName = row.city;
    const countryCode = (row.countryName ?? "XX").slice(0, 2).toUpperCase();
    const [w, s, e, n] = probeBbox;

    try {
      const ins = await db.execute(sql`
        INSERT INTO subway_systems (city_key, city_name, country_code, source, bbox)
        VALUES (
          ${cityKey},
          ${cityName},
          ${countryCode},
          'discovered',
          ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)::geometry
        )
        ON CONFLICT (city_key) DO NOTHING
      `);
      if (ins.rowCount && ins.rowCount > 0) {
        logger.info("discovered new subway city", {
          cityKey,
          cityName,
          countryCode,
          visitCount: row.visitCount,
          lineCount,
        });
        added++;
      }
    } catch (err) {
      logger.error("subway discovery insert failed", {
        cityKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Politeness pause between Overpass probes.
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (added > 0) {
    logger.info("subway discovery added cities — full data fetched on next refresh", {
      userId,
      added,
    });
  }
}
