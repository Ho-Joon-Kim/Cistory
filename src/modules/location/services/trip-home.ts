import { and, desc, eq, gte, sql } from "drizzle-orm";
import { type Database, getDb, visits } from "@/db";

export const TRIP_HOME_DISTANCE_THRESHOLD_M = 100_000;

export interface TripHomeLocation {
  lat: number;
  lon: number;
}

export interface TripHomePlace extends TripHomeLocation {
  name: string;
  category: string | null;
}

type HomeQueryClient = Pick<Database, "select">;

function isHomeLabel(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLocaleLowerCase("en-US");
  return normalized === "home" || normalized === "집";
}

/** Resolve home exactly as trip detection does: an explicit saved home first,
 * then the highest-duration visit location from the last 90 days. */
export async function resolveTripHomeLocation(
  userId: string,
  places: TripHomePlace[],
  database: HomeQueryClient = getDb()
): Promise<TripHomeLocation | null> {
  const homePlace = places.find((place) => isHomeLabel(place.category) || isHomeLabel(place.name));
  if (homePlace) return { lat: homePlace.lat, lon: homePlace.lon };

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const [topVisit] = await database
    .select({
      lat: visits.centerLat,
      lon: visits.centerLon,
      totalDuration: sql<number>`sum(${visits.durationSeconds})`,
    })
    .from(visits)
    .where(and(eq(visits.userId, userId), gte(visits.startTime, ninetyDaysAgo)))
    .groupBy(
      sql`round(${visits.centerLat}::numeric, 3)`,
      sql`round(${visits.centerLon}::numeric, 3)`,
      visits.centerLat,
      visits.centerLon
    )
    .orderBy(desc(sql`sum(${visits.durationSeconds})`))
    .limit(1);

  if (topVisit && Number.isFinite(topVisit.lat) && Number.isFinite(topVisit.lon)) {
    return { lat: topVisit.lat, lon: topVisit.lon };
  }

  return null;
}
