import { eq, inArray, sql } from "drizzle-orm";
import { type Database, getDb, trips, users } from "@/db";
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
  database?: Database;
}

export interface TripWriteResult {
  inserted: number;
  replaced: number;
  skipped: number;
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
  replaceAllAuto: boolean,
  watermarkThrough?: string
): Promise<TripWriteResult> {
  // This read deliberately happens after the advisory lock. Every writer sees
  // the state committed by the previous holder before it plans its mutation.
  const existing = await readExistingTrips(tx, userId);
  const plan = planTripReconciliation(existing, candidates, replaceAllAuto);

  if (plan.deleteAutoIds.length > 0) {
    await tx.delete(trips).where(inArray(trips.id, plan.deleteAutoIds));
  }
  if (plan.acceptedCandidates.length > 0) {
    await tx.insert(trips).values(detectedTripRows(userId, plan.acceptedCandidates));
  }
  if (watermarkThrough) {
    await tx
      .update(users)
      .set({ tripDetectionLastThrough: watermarkThrough, updatedAt: new Date() })
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
    (tx) => applyDetectedTrips(tx, userId, candidates, false, options.watermarkThrough),
    options.database
  );
}

export async function regenerateDetectedTrips(
  userId: string,
  candidates: DetectedTrip[],
  database: Database = getDb()
): Promise<TripWriteResult> {
  assertValidDetectedTrips(candidates);
  return withTripWriteLock(
    userId,
    (tx) => applyDetectedTrips(tx, userId, candidates, true),
    database
  );
}
