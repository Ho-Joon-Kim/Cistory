import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";

/**
 * Korean when it has Hangul and no romanized words: a fallback geocoder can mix
 * them ("목척7길 Jung-gu, Daejeon, South Korea"), which still reads as English.
 * Mirrored by the `~ '[가-힣]' AND !~ '[A-Za-z]{3,}'` filter below.
 */
export function isKoreanAddress(address: string | null | undefined): boolean {
  return !!address && /[가-힣]/.test(address) && !/[A-Za-z]{3,}/.test(address);
}

/** Half-width of the lat/lon box searched around a saved place (~200 m). */
export const NEAREST_KOREAN_ADDRESS_DEG = 0.002;

/**
 * For each of `placeIds` (the owner's saved places), the nearest Korean address
 * already cached in `place_cache` within ±{@link NEAREST_KOREAN_ADDRESS_DEG}°.
 * Romanized geocodes ("Nonhyeon-dong, 06112, Gangnam-gu, …") read badly in a
 * Korean UI. Places of other users are never read, even if their ids are passed.
 */
export async function nearestKoreanAddresses(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  placeIds: string[]
): Promise<Map<string, string>> {
  const korean = new Map<string, string>();
  if (placeIds.length === 0) return korean;
  const d = NEAREST_KOREAN_ADDRESS_DEG;
  const rows = await db.execute<{ id: string; address: string }>(sql`
    SELECT sp.id, ko.address FROM saved_places sp
    CROSS JOIN LATERAL (
      SELECT pc.address FROM place_cache pc
      WHERE pc.address ~ '[가-힣]' AND pc.address !~ '[A-Za-z]{3,}'
        AND pc.lat_key BETWEEN sp.lat - ${d} AND sp.lat + ${d}
        AND pc.lon_key BETWEEN sp.lon - ${d} AND sp.lon + ${d}
      ORDER BY (pc.lat_key - sp.lat) ^ 2 + (pc.lon_key - sp.lon) ^ 2
      LIMIT 1
    ) ko
    WHERE sp.user_id = ${userId}
      AND sp.id IN (${sql.join(
        placeIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )})`);
  for (const row of rows.rows) korean.set(row.id, row.address);
  return korean;
}
