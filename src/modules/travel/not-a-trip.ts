import { and, eq, gte, lt } from "drizzle-orm";
import { type Database, getDb, savedPlaces, trips, visits } from "@/db";
import { getKstDateWindow } from "@/lib/date-key";
import { distanceM } from "@/lib/geo";
import { withTripWriteLock } from "@/modules/location/services/trip-writer";

const DEFAULT_EXCLUSION_RADIUS_M = 10_000;
const SAVED_PLACE_PIN_RADIUS_M = 100;

export class TripNotFoundError extends Error {
  constructor() {
    super("여행을 찾을 수 없습니다");
    this.name = "TripNotFoundError";
  }
}

export class TripHasNoVisitsError extends Error {
  constructor() {
    super("여행 기간에 제외 장소를 만들 방문 기록이 없습니다");
    this.name = "TripHasNoVisitsError";
  }
}

export interface DominantVisitInput {
  centerLat: number;
  centerLon: number;
  durationSeconds: number;
  placeName: string | null;
  address: string | null;
  city: string | null;
}

export interface DominantVisitCenter {
  lat: number;
  lon: number;
  durationSeconds: number;
  placeName: string | null;
  address: string | null;
  city: string | null;
}

interface VisitCluster {
  visits: DominantVisitInput[];
  durationSeconds: number;
  weightedLat: number;
  weightedLon: number;
}

function clusterCenter(cluster: VisitCluster): { lat: number; lon: number } {
  return {
    lat: cluster.weightedLat / cluster.durationSeconds,
    lon: cluster.weightedLon / cluster.durationSeconds,
  };
}

export function findDominantVisitCenter(
  allVisits: DominantVisitInput[]
): DominantVisitCenter | null {
  const clusters: VisitCluster[] = [];

  for (const visit of allVisits) {
    const durationSeconds = Math.max(1, visit.durationSeconds);
    const cluster = clusters.find((candidate) => {
      const center = clusterCenter(candidate);
      return (
        distanceM(center.lat, center.lon, visit.centerLat, visit.centerLon) <=
        DEFAULT_EXCLUSION_RADIUS_M
      );
    });
    if (cluster) {
      cluster.visits.push(visit);
      cluster.durationSeconds += durationSeconds;
      cluster.weightedLat += visit.centerLat * durationSeconds;
      cluster.weightedLon += visit.centerLon * durationSeconds;
    } else {
      clusters.push({
        visits: [visit],
        durationSeconds,
        weightedLat: visit.centerLat * durationSeconds,
        weightedLon: visit.centerLon * durationSeconds,
      });
    }
  }

  const dominant = clusters.sort((left, right) => right.durationSeconds - left.durationSeconds)[0];
  if (!dominant) return null;
  const center = clusterCenter(dominant);
  const representative = dominant.visits.reduce((longest, current) =>
    current.durationSeconds > longest.durationSeconds ? current : longest
  );

  return {
    ...center,
    durationSeconds: dominant.durationSeconds,
    placeName: representative.placeName,
    address: representative.address,
    city: representative.city,
  };
}

function exclusionPlaceName(
  tripName: string,
  center: Pick<DominantVisitCenter, "placeName" | "city">
): string {
  if (center.placeName) return center.placeName;
  if (center.city) return `${center.city} 정기 방문지`;
  return `${tripName} 정기 방문지`;
}

export async function markTripNotATrip(
  userId: string,
  tripId: string,
  database: Database = getDb()
) {
  return withTripWriteLock(
    userId,
    async (tx) => {
      const [trip] = await tx
        .select({
          id: trips.id,
          startDate: trips.startDate,
          endDate: trips.endDate,
          name: trips.name,
        })
        .from(trips)
        .where(and(eq(trips.id, tripId), eq(trips.userId, userId)));
      if (!trip) throw new TripNotFoundError();

      const window = getKstDateWindow(trip.startDate, trip.endDate);

      const tripVisits = await tx
        .select({
          centerLat: visits.centerLat,
          centerLon: visits.centerLon,
          durationSeconds: visits.durationSeconds,
          placeName: visits.placeName,
          address: visits.address,
          city: visits.city,
        })
        .from(visits)
        .where(
          and(
            eq(visits.userId, userId),
            gte(visits.startTime, window.start),
            lt(visits.startTime, window.end)
          )
        );
      const center = findDominantVisitCenter(tripVisits);
      if (!center) throw new TripHasNoVisitsError();

      const userPlaces = await tx.select().from(savedPlaces).where(eq(savedPlaces.userId, userId));
      const existingPlace = userPlaces
        .map((place) => ({
          place,
          distance: distanceM(place.lat, place.lon, center.lat, center.lon),
        }))
        .filter(({ distance }) => distance <= DEFAULT_EXCLUSION_RADIUS_M)
        .sort((left, right) => left.distance - right.distance)[0]?.place;

      const now = new Date();
      let place: typeof savedPlaces.$inferSelect | undefined;
      if (existingPlace) {
        [place] = await tx
          .update(savedPlaces)
          .set({
            excludeFromTrips: true,
            tripExclusionRadiusM: DEFAULT_EXCLUSION_RADIUS_M,
            updatedAt: now,
          })
          .where(and(eq(savedPlaces.id, existingPlace.id), eq(savedPlaces.userId, userId)))
          .returning();
      } else {
        [place] = await tx
          .insert(savedPlaces)
          .values({
            userId,
            name: exclusionPlaceName(trip.name, center),
            lat: center.lat,
            lon: center.lon,
            radiusM: SAVED_PLACE_PIN_RADIUS_M,
            category: null,
            address: center.address,
            excludeFromTrips: true,
            tripExclusionRadiusM: DEFAULT_EXCLUSION_RADIUS_M,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
      }
      if (!place) throw new Error("여행 제외 장소를 저장하지 못했습니다");

      const [deleted] = await tx
        .delete(trips)
        .where(and(eq(trips.id, tripId), eq(trips.userId, userId)))
        .returning({ id: trips.id });
      if (!deleted) throw new TripNotFoundError();

      return { tripId, place, reusedPlace: Boolean(existingPlace) };
    },
    database
  );
}
