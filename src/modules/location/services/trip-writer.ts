import { eq, inArray, sql } from "drizzle-orm";
import { type Database, getDb, savedPlaces, trips, users } from "@/db";
import type { DetectedTrip } from "./trip-detector";

type TripWriteTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

interface ExistingTripRange {
  id: string;
  startDate: string;
  endDate: string;
  autoDetected: boolean;
}

interface TripReconciliationPlan {
  deleteAutoIds: string[];
  acceptedCandidates: DetectedTrip[];
  manualSkipped: number;
}

export interface ReconcileDetectedTripsOptions {
  watermarkThrough?: string;
  expectedExclusionRevision?: string;
  database?: Database;
}

export type RegenerateDetectedTripsOptions = Omit<
  ReconcileDetectedTripsOptions,
  "watermarkThrough"
>;

export interface TripWriteResult {
  inserted: number;
  replaced: number;
  skipped: number;
}

interface TripExclusionState {
  id: string;
  name: string;
  lat: number;
  lon: number;
  category: string | null;
  excludeFromTrips: boolean;
  tripExclusionRadiusM: number | null;
  updatedAt: Date;
}

export class StaleTripDetectionError extends Error {
  constructor() {
    super("여행 제외 설정이 바뀌어 후보를 다시 계산해야 합니다");
    this.name = "StaleTripDetectionError";
  }
}

export function createTripExclusionRevision(states: TripExclusionState[]): string {
  return JSON.stringify(
    [...states]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((state) => [
        state.id,
        state.name,
        state.lat,
        state.lon,
        state.category,
        state.excludeFromTrips,
        state.tripExclusionRadiusM,
        state.updatedAt instanceof Date ? state.updatedAt.getTime() : String(state.updatedAt),
      ])
  );
}

function rangesOverlap(
  left: Pick<ExistingTripRange, "startDate" | "endDate">,
  right: Pick<DetectedTrip, "startDate" | "endDate">
): boolean {
  return left.startDate <= right.endDate && right.startDate <= left.endDate;
}

export function planTripReconciliation(
  existing: ExistingTripRange[],
  candidates: DetectedTrip[],
  replaceAllAuto: boolean
): TripReconciliationPlan {
  const manual = existing.filter((trip) => !trip.autoDetected);
  const acceptedCandidates = candidates.filter(
    (candidate) => !manual.some((trip) => rangesOverlap(trip, candidate))
  );

  const deleteAutoIds = existing
    .filter(
      (trip) =>
        trip.autoDetected &&
        (replaceAllAuto || acceptedCandidates.some((candidate) => rangesOverlap(trip, candidate)))
    )
    .map((trip) => trip.id);

  return {
    deleteAutoIds,
    acceptedCandidates,
    manualSkipped: candidates.length - acceptedCandidates.length,
  };
}

export function isValidDetectedTrip(value: unknown): value is DetectedTrip {
  if (!value || typeof value !== "object") return false;
  const trip = value as Partial<DetectedTrip>;
  const isValidDate = (date: unknown): date is string => {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const [year, month, day] = date.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === date;
  };
  return (
    typeof trip.name === "string" &&
    trip.name.trim().length > 0 &&
    isValidDate(trip.startDate) &&
    isValidDate(trip.endDate) &&
    trip.startDate <= trip.endDate &&
    Array.isArray(trip.visitedCities) &&
    trip.visitedCities.every((city) => typeof city === "string") &&
    Array.isArray(trip.visitedCountries) &&
    trip.visitedCountries.every((country) => typeof country === "string") &&
    typeof trip.isOverseas === "boolean" &&
    (trip.totalDistanceMeters === null ||
      (typeof trip.totalDistanceMeters === "number" &&
        Number.isFinite(trip.totalDistanceMeters) &&
        trip.totalDistanceMeters >= 0))
  );
}

export function assertValidDetectedTrips(
  candidates: unknown[]
): asserts candidates is DetectedTrip[] {
  if (!candidates.every(isValidDetectedTrip)) {
    throw new Error("유효하지 않은 여행 후보가 포함되어 있습니다");
  }
}

export async function withTripWriteLock<T>(
  userId: string,
  operation: (tx: TripWriteTransaction) => Promise<T>,
  database: Database = getDb()
): Promise<T> {
  return database.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`trip-write:${userId}`}, 0))`
    );
    return operation(tx);
  });
}

async function readExistingTrips(
  tx: TripWriteTransaction,
  userId: string
): Promise<ExistingTripRange[]> {
  return tx
    .select({
      id: trips.id,
      startDate: trips.startDate,
      endDate: trips.endDate,
      autoDetected: trips.autoDetected,
    })
    .from(trips)
    .where(eq(trips.userId, userId));
}

async function readTripExclusionRevision(
  tx: TripWriteTransaction,
  userId: string
): Promise<string> {
  const states = await tx
    .select({
      id: savedPlaces.id,
      name: savedPlaces.name,
      lat: savedPlaces.lat,
      lon: savedPlaces.lon,
      category: savedPlaces.category,
      excludeFromTrips: savedPlaces.excludeFromTrips,
      tripExclusionRadiusM: savedPlaces.tripExclusionRadiusM,
      updatedAt: savedPlaces.updatedAt,
    })
    .from(savedPlaces)
    .where(eq(savedPlaces.userId, userId));
  return createTripExclusionRevision(states);
}

function detectedTripRows(userId: string, candidates: DetectedTrip[]) {
  const now = new Date();
  return candidates.map((trip) => ({
    userId,
    name: trip.name,
    startDate: trip.startDate,
    endDate: trip.endDate,
    totalDistanceMeters: trip.totalDistanceMeters,
    visitedCities: JSON.stringify(trip.visitedCities),
    visitedCountries: JSON.stringify(trip.visitedCountries),
    isOverseas: trip.isOverseas,
    autoDetected: true,
    createdAt: now,
    updatedAt: now,
  }));
}

async function applyDetectedTrips(
  tx: TripWriteTransaction,
  userId: string,
  candidates: DetectedTrip[],
  options: {
    replaceAllAuto: boolean;
    watermarkThrough?: string;
    expectedExclusionRevision?: string;
  }
): Promise<TripWriteResult> {
  if (
    options.expectedExclusionRevision !== undefined &&
    (await readTripExclusionRevision(tx, userId)) !== options.expectedExclusionRevision
  ) {
    throw new StaleTripDetectionError();
  }
  // This read deliberately happens after the advisory lock. Every writer sees
  // the state committed by the previous holder before it plans its mutation.
  const existing = await readExistingTrips(tx, userId);
  const plan = planTripReconciliation(existing, candidates, options.replaceAllAuto);

  if (plan.deleteAutoIds.length > 0) {
    await tx.delete(trips).where(inArray(trips.id, plan.deleteAutoIds));
  }
  if (plan.acceptedCandidates.length > 0) {
    await tx.insert(trips).values(detectedTripRows(userId, plan.acceptedCandidates));
  }
  if (options.watermarkThrough) {
    await tx
      .update(users)
      .set({ tripDetectionLastThrough: options.watermarkThrough, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  return {
    inserted: plan.acceptedCandidates.length,
    replaced: plan.deleteAutoIds.length,
    skipped: plan.manualSkipped,
  };
}

export async function reconcileDetectedTrips(
  userId: string,
  candidates: DetectedTrip[],
  options: ReconcileDetectedTripsOptions = {}
): Promise<TripWriteResult> {
  assertValidDetectedTrips(candidates);
  return withTripWriteLock(
    userId,
    (tx) =>
      applyDetectedTrips(tx, userId, candidates, {
        replaceAllAuto: false,
        watermarkThrough: options.watermarkThrough,
        expectedExclusionRevision: options.expectedExclusionRevision,
      }),
    options.database
  );
}

export async function regenerateDetectedTrips(
  userId: string,
  candidates: DetectedTrip[],
  options: RegenerateDetectedTripsOptions = {}
): Promise<TripWriteResult> {
  assertValidDetectedTrips(candidates);
  return withTripWriteLock(
    userId,
    (tx) =>
      applyDetectedTrips(tx, userId, candidates, {
        replaceAllAuto: true,
        expectedExclusionRevision: options.expectedExclusionRevision,
      }),
    options.database
  );
}
