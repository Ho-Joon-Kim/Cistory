import { eq, sql } from "drizzle-orm";
import { getDb, subwaySystems } from "@/db";
import type { SubwaySystem } from "@/db/schema";
import { getOverpassAdapter } from "@/lib/adapters/overpass";
import type { SubwayFetchResult } from "@/lib/adapters/overpass/interface";
import { SEED_CITIES } from "@/lib/adapters/overpass/seed-cities";
import { logger } from "@/lib/logger";

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

async function persistFetchResult(
  systemId: string,
  result: SubwayFetchResult
): Promise<void> {
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
