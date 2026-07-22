import { eq, sql } from "drizzle-orm";
import { getDb, subwaySystems } from "@/db";
import type { SubwaySystem } from "@/db/schema";
import { getOverpassAdapter } from "@/lib/adapters/overpass";
import type { SubwayFetchResult } from "@/lib/adapters/overpass/interface";
import { SEED_CITIES } from "@/lib/adapters/overpass/seed-cities";
import { logger } from "@/lib/logger";
import { resolveLineColor } from "@/lib/subway-color";
import {
  buildStationLineIndex,
  resolveStationLines,
  type StationLine,
} from "@/modules/subway/station-lines";

/**
 * Idempotent seed — inserts any SEED_CITIES entry not already present, matched
 * by city_key. Existing rows are untouched (bbox/data stay as-is). Safe to call
 * on every boot.
 */
export async function seedSubwaySystemsIfEmpty(): Promise<void> {
  const db = getDb();
  let inserted = 0;
  for (const city of SEED_CITIES) {
    const [w, s, e, n] = city.bbox;
    const result = await db.execute(sql`
      INSERT INTO subway_systems (city_key, city_name, country_code, source, bbox)
      VALUES (
        ${city.cityKey}, ${city.cityName}, ${city.countryCode}, 'seed',
        ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)::geometry
      )
      ON CONFLICT (city_key) DO NOTHING
    `);
    if (result.rowCount && result.rowCount > 0) inserted++;
  }
  if (inserted > 0) {
    logger.info("seeded new subway_systems entries", { inserted, total: SEED_CITIES.length });
  }
}

interface SystemRow {
  id: string;
  city_key: string;
  bbox_w: number;
  bbox_s: number;
  bbox_e: number;
  bbox_n: number;
}

async function getSystemWithBbox(systemId: string): Promise<SystemRow | null> {
  const db = getDb();
  const res = await db.execute(sql`
    SELECT id, city_key,
      ST_XMin(bbox) AS bbox_w, ST_YMin(bbox) AS bbox_s,
      ST_XMax(bbox) AS bbox_e, ST_YMax(bbox) AS bbox_n
    FROM subway_systems
    WHERE id = ${systemId}
    LIMIT 1
  `);
  const row = res.rows[0] as unknown as SystemRow | undefined;
  return row ?? null;
}

async function persistFetchResult(systemId: string, result: SubwayFetchResult): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM subway_lines WHERE system_id = ${systemId}`);
    await tx.execute(sql`DELETE FROM subway_stations WHERE system_id = ${systemId}`);

    for (const line of result.lines) {
      await tx.execute(sql`
        INSERT INTO subway_lines
          (system_id, osm_relation_id, name, name_en, ref, colour, operator, network, geometry)
        VALUES (
          ${systemId},
          ${line.osmRelationId},
          ${line.name ?? null},
          ${line.nameEn ?? null},
          ${line.ref ?? null},
          ${line.colour ?? null},
          ${line.operator ?? null},
          ${line.network ?? null},
          ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(line.geometry)}), 4326)
        )
      `);
    }

    for (const st of result.stations) {
      await tx.execute(sql`
        INSERT INTO subway_stations
          (system_id, osm_node_id, name, name_en, line_refs, location)
        VALUES (
          ${systemId},
          ${st.osmNodeId},
          ${st.name ?? null},
          ${st.nameEn ?? null},
          ${JSON.stringify(st.lineRefs)}::jsonb,
          ST_SetSRID(ST_MakePoint(${st.lon}, ${st.lat}), 4326)
        )
      `);
    }

    await tx
      .update(subwaySystems)
      .set({
        lastRefreshedAt: new Date(),
        lineCount: result.lines.length,
        stationCount: result.stations.length,
      })
      .where(eq(subwaySystems.id, systemId));
  });
}

/**
 * 한 도시(subway_system row) 갱신: Overpass fetch → 트랜잭션 내 upsert.
 */
export async function fetchAndPersistSubwaySystem(
  system: Pick<SubwaySystem, "id" | "cityKey">
): Promise<{ lineCount: number; stationCount: number }> {
  const row = await getSystemWithBbox(system.id);
  if (!row) {
    throw new Error(`subway_system ${system.id} not found`);
  }
  const bbox: [number, number, number, number] = [
    Number(row.bbox_w),
    Number(row.bbox_s),
    Number(row.bbox_e),
    Number(row.bbox_n),
  ];

  logger.info("fetching subway data", { cityKey: row.city_key, bbox });
  const result = await getOverpassAdapter().fetchSubwayInBbox(bbox);
  await persistFetchResult(system.id, result);

  return {
    lineCount: result.lines.length,
    stationCount: result.stations.length,
  };
}

/**
 * 모든 등록된 subway_system 순차 갱신. Overpass rate limit 보호로 5초 간격.
 * 한 도시 실패는 전체 중단시키지 않고 로그만 남김.
 */
export async function refreshAllSubwaySystems(): Promise<void> {
  const db = getDb();
  const systems = await db.select().from(subwaySystems);
  logger.info("refreshing all subway systems", { total: systems.length });

  for (const sys of systems) {
    try {
      const counts = await fetchAndPersistSubwaySystem(sys);
      logger.info("subway system refreshed", {
        cityKey: sys.cityKey,
        ...counts,
      });
    } catch (err) {
      logger.error("subway system refresh failed", {
        cityKey: sys.cityKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

// ── Map overlay (public reference data) ──────────────────────────────────────

interface OverlayLineRow {
  id: string;
  system_id: string;
  name: string | null;
  name_en: string | null;
  ref: string | null;
  colour: string | null;
  network: string | null;
  fallback_idx: number | string;
  geom: GeoJSON.MultiLineString;
}

interface OverlayStationRow {
  id: string;
  system_id: string;
  name: string | null;
  name_en: string | null;
  line_refs: unknown;
  lat: number | string;
  lon: number | string;
}

export interface SubwayOverlay {
  lines: GeoJSON.FeatureCollection;
  stations: GeoJSON.FeatureCollection;
}

/**
 * Subway lines/stations intersecting a viewport bbox, as GeoJSON.
 *
 * Line geometry is simplified with a tolerance proportional to the bbox
 * width (~1px at a 2048px viewport): a country-wide bbox previously shipped
 * every vertex of every line — megabytes of coordinates the client can't
 * even render at that zoom — while a city-level bbox gets an imperceptible
 * tolerance and stays visually exact.
 */
export async function getSubwayOverlay(
  bbox: [number, number, number, number]
): Promise<SubwayOverlay> {
  const [w, s, e, n] = bbox;
  const db = getDb();
  const simplifyTolerance = (e - w) / 2048;

  // Lines: assign a fallback_idx to colour-less lines within the same system so
  // the hash fallback can spread them via golden-angle. Lines with an OSM
  // `colour` tag get fallback_idx=0 (unused).
  const linesRes = await db.execute(sql`
    WITH numbered AS (
      SELECT id, system_id, name, name_en, ref, colour, network,
             CASE WHEN colour IS NULL
                  THEN (ROW_NUMBER() OVER (PARTITION BY system_id, (colour IS NULL)
                                            ORDER BY ref, name, id) - 1)
                  ELSE 0 END AS fallback_idx,
             ST_AsGeoJSON(ST_SimplifyPreserveTopology(geometry, ${simplifyTolerance}))::json AS geom
      FROM subway_lines
      WHERE ST_Intersects(
        geometry,
        ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)
      )
    )
    SELECT id, system_id, name, name_en, ref, colour, network, fallback_idx, geom FROM numbered
  `);

  const lineRows = linesRes.rows as unknown as OverlayLineRow[];
  const stationLines: StationLine[] = lineRows.map((row) => ({
    id: row.id,
    systemId: row.system_id,
    name: row.name,
    ref: row.ref,
    color: resolveLineColor({
      colour: row.colour,
      network: row.network,
      ref: row.ref,
      name: row.name,
      fallbackIndex: Number(row.fallback_idx) || 0,
    }),
  }));

  const lineFeatures: GeoJSON.Feature[] = lineRows.map((row, i) => ({
    type: "Feature",
    geometry: row.geom,
    properties: {
      id: row.id,
      name: row.name,
      nameEn: row.name_en,
      ref: row.ref,
      color: stationLines[i].color,
    },
  }));

  const stationsRes = await db.execute(sql`
    SELECT id, system_id, name, name_en, line_refs,
           ST_X(location) AS lon, ST_Y(location) AS lat
    FROM subway_stations
    WHERE ST_Intersects(
      location,
      ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)
    )
  `);

  // A station always sits on its own line, so any line referenced by a station
  // inside the bbox also intersects the bbox and is present in `lineRows`.
  const stationLineIndex = buildStationLineIndex(stationLines);

  const stationFeatures: GeoJSON.Feature[] = (
    stationsRes.rows as unknown as OverlayStationRow[]
  ).map((row) => {
    const lineRefs = (Array.isArray(row.line_refs) ? row.line_refs : []).filter(
      (ref): ref is string => typeof ref === "string"
    );
    const matched = resolveStationLines(stationLineIndex, row.system_id, lineRefs);

    return {
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [Number(row.lon), Number(row.lat)],
      },
      properties: {
        id: row.id,
        name: row.name,
        nameEn: row.name_en,
        lineRefs,
        lineIds: matched.map((line) => line.id),
        // Primary line colour (lowest-numbered line) — the map paints the dot
        // with it. Undefined when no line matched; the client falls back.
        color: matched[0]?.color,
        isTransfer: lineRefs.length > 1,
      },
    };
  });

  return {
    lines: { type: "FeatureCollection", features: lineFeatures },
    stations: { type: "FeatureCollection", features: stationFeatures },
  };
}
