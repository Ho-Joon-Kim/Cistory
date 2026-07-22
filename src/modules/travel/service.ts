import { and, asc, desc, eq, gte, lt, or, sql } from "drizzle-orm";
import type { Database } from "@/db";
import {
  accountRoles,
  codingDailyStats,
  commits,
  healthDailySummaries,
  transactions,
  transportationSegments,
  trips,
  users,
  visits,
} from "@/db/schema";
import { getKstDateWindow, shiftDateKey } from "@/lib/date-key";
import { accountRolesJoinOn, bucketSql } from "@/modules/spending/classify";

export const DEFAULT_TRIP_LIST_LIMIT = 20;
export const MAX_TRIP_LIST_LIMIT = 50;

export interface TripCursor {
  endDate: string;
  startDate: string;
  id: string;
}

export interface TravelTrip {
  id: string;
  userId: string;
  name: string;
  startDate: string;
  endDate: string;
  totalDistanceMeters: number | null;
  visitedCities: string[];
  visitedCountries: string[];
  isOverseas: boolean;
  autoDetected: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TripListItem extends TravelTrip {
  totalSpending: number;
  visitCount: number;
}

export interface TripVisit {
  id: string;
  centerLat: number;
  centerLon: number;
  startTime: Date;
  endTime: Date;
  durationSeconds: number;
  placeName: string | null;
  address: string | null;
  category: string | null;
  city: string | null;
  countryName: string | null;
}

export interface TripTransaction {
  id: string;
  amount: number;
  merchant: string;
  accountName: string;
  category: string | null;
  transactedAt: Date;
}

export interface TripSpending {
  total: number;
  dailyAverage: number;
  categories: { category: string; total: number; count: number }[];
  transactions: TripTransaction[];
}

export interface TripTransport {
  totalDistanceMeters: number;
  modes: {
    mode: string;
    distanceMeters: number;
    durationSeconds: number;
    segmentCount: number;
  }[];
}

export interface TripRoutine {
  codingSeconds: number;
  commitCount: number;
  comparison: {
    codingSeconds: number;
    commitCount: number;
    codingPercentChange: number | null;
    commitPercentChange: number | null;
  } | null;
}

export interface TripHealthSummary {
  day: string;
  metric: string;
  valueAvg: number | null;
  valueMin: number | null;
  valueMax: number | null;
  valueSum: number | null;
  count: number | null;
}

export interface TripDetail {
  trip: TravelTrip;
  visits: TripVisit[];
  spending: TripSpending;
  transport: TripTransport;
  routine: TripRoutine;
  health: TripHealthSummary[];
}

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function normalizeTrip(row: typeof trips.$inferSelect): TravelTrip {
  return {
    ...row,
    visitedCities: parseStringArray(row.visitedCities),
    visitedCountries: parseStringArray(row.visitedCountries),
  };
}

export function encodeTripCursor(cursor: TripCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeTripCursor(value: string): TripCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<TripCursor>;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(candidate.endDate ?? "") ||
      !/^\d{4}-\d{2}-\d{2}$/.test(candidate.startDate ?? "") ||
      typeof candidate.id !== "string" ||
      candidate.id.length === 0
    ) {
      return null;
    }
    return candidate as TripCursor;
  } catch {
    return null;
  }
}

export function aggregateSpending(rows: TripTransaction[], dayCount: number): TripSpending {
  const byCategory = new Map<string, { total: number; count: number }>();
  let total = 0;
  for (const row of rows) {
    total += row.amount;
    const category = row.category ?? "uncategorized";
    const aggregate = byCategory.get(category) ?? { total: 0, count: 0 };
    aggregate.total += row.amount;
    aggregate.count += 1;
    byCategory.set(category, aggregate);
  }

  return {
    total,
    dailyAverage: dayCount > 0 ? Math.round(total / dayCount) : 0,
    categories: [...byCategory.entries()]
      .map(([category, aggregate]) => ({ category, ...aggregate }))
      .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category)),
    transactions: rows,
  };
}

export class TravelService {
  constructor(private readonly db: Database) {}

  async listTrips(
    userId: string,
    options: { limit: number; cursor: TripCursor | null }
  ): Promise<{ trips: TripListItem[]; nextCursor: string | null }> {
    const [userRow] = await this.db
      .select({ tossMyName: users.tossMyName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const bucket = bucketSql(userRow?.tossMyName ?? null);
    const { limit, cursor } = options;
    const cursorCondition = cursor
      ? or(
          lt(trips.endDate, cursor.endDate),
          and(eq(trips.endDate, cursor.endDate), lt(trips.startDate, cursor.startDate)),
          and(
            eq(trips.endDate, cursor.endDate),
            eq(trips.startDate, cursor.startDate),
            lt(trips.id, cursor.id)
          )
        )
      : undefined;

    const rows = await this.db
      .select({
        id: trips.id,
        userId: trips.userId,
        name: trips.name,
        startDate: trips.startDate,
        endDate: trips.endDate,
        totalDistanceMeters: trips.totalDistanceMeters,
        visitedCities: trips.visitedCities,
        visitedCountries: trips.visitedCountries,
        isOverseas: trips.isOverseas,
        autoDetected: trips.autoDetected,
        notes: trips.notes,
        createdAt: trips.createdAt,
        updatedAt: trips.updatedAt,
        visitCount: sql<number>`(
          SELECT count(*)
          FROM ${visits}
          WHERE ${visits.userId} = ${userId}
            AND ${visits.startTime} >= (${trips.startDate}::date - interval '9 hours')
            AND ${visits.startTime} < ((${trips.endDate}::date + interval '1 day') - interval '9 hours')
        )`.as("visit_count"),
        totalSpending: sql<number>`(
          SELECT coalesce(sum(${transactions.amount}), 0)
          FROM ${transactions}
          LEFT JOIN ${accountRoles}
            ON ${accountRoles.userId} = ${transactions.userId}
           AND ${accountRoles.accountName} = ${transactions.accountName}
          WHERE ${transactions.userId} = ${userId}
            AND ${transactions.transactedAt} >= (${trips.startDate}::date - interval '9 hours')
            AND ${transactions.transactedAt} < ((${trips.endDate}::date + interval '1 day') - interval '9 hours')
            AND ${bucket} = 'spending'
        )`.as("total_spending"),
      })
      .from(trips)
      .where(and(eq(trips.userId, userId), cursorCondition))
      .orderBy(desc(trips.endDate), desc(trips.startDate), desc(trips.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return {
      trips: page.map((row) => ({
        ...normalizeTrip(row),
        totalSpending: Number(row.totalSpending),
        visitCount: Number(row.visitCount),
      })),
      nextCursor:
        hasMore && last
          ? encodeTripCursor({ endDate: last.endDate, startDate: last.startDate, id: last.id })
          : null,
    };
  }

  async getTripDetail(userId: string, tripId: string): Promise<TripDetail | null> {
    const [tripRow] = await this.db
      .select()
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.userId, userId)))
      .limit(1);
    if (!tripRow) return null;

    const trip = normalizeTrip(tripRow);
    const window = getKstDateWindow(trip.startDate, trip.endDate);
    const previousStartDate = shiftDateKey(trip.startDate, -window.dayCount);
    const previousStart = new Date(`${previousStartDate}T00:00:00+09:00`);

    const [userRow] = await this.db
      .select({ tossMyName: users.tossMyName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const bucket = bucketSql(userRow?.tossMyName ?? null);

    const [visitRows, transportRows, transactionRows, codingRows, commitRows, healthRows] =
      await Promise.all([
        this.db
          .select({
            id: visits.id,
            centerLat: visits.centerLat,
            centerLon: visits.centerLon,
            startTime: visits.startTime,
            endTime: visits.endTime,
            durationSeconds: visits.durationSeconds,
            placeName: visits.placeName,
            address: visits.address,
            category: visits.category,
            city: visits.city,
            countryName: visits.countryName,
          })
          .from(visits)
          .where(
            and(
              eq(visits.userId, userId),
              gte(visits.startTime, window.start),
              lt(visits.startTime, window.end)
            )
          )
          .orderBy(asc(visits.startTime)),
        this.db
          .select({
            mode: transportationSegments.mode,
            distanceMeters: transportationSegments.distanceMeters,
            durationSeconds: transportationSegments.durationSeconds,
          })
          .from(transportationSegments)
          .where(
            and(
              eq(transportationSegments.userId, userId),
              gte(transportationSegments.date, trip.startDate),
              lt(transportationSegments.date, window.endExclusiveDate)
            )
          )
          .orderBy(asc(transportationSegments.startTime)),
        this.db
          .select({
            id: transactions.id,
            amount: transactions.amount,
            merchant: transactions.merchant,
            accountName: transactions.accountName,
            category: transactions.category,
            transactedAt: transactions.transactedAt,
          })
          .from(transactions)
          .leftJoin(accountRoles, accountRolesJoinOn)
          .where(
            and(
              eq(transactions.userId, userId),
              gte(transactions.transactedAt, window.start),
              lt(transactions.transactedAt, window.end),
              sql`${bucket} = 'spending'`
            )
          )
          .orderBy(asc(transactions.transactedAt)),
        this.db
          .select({ date: codingDailyStats.date, totalSeconds: codingDailyStats.totalSeconds })
          .from(codingDailyStats)
          .where(
            and(
              eq(codingDailyStats.userId, userId),
              gte(codingDailyStats.date, previousStartDate),
              lt(codingDailyStats.date, window.endExclusiveDate)
            )
          )
          .orderBy(asc(codingDailyStats.date)),
        this.db
          .select({ id: commits.id, committedAt: commits.committedAt })
          .from(commits)
          .where(
            and(
              eq(commits.userId, userId),
              gte(commits.committedAt, previousStart),
              lt(commits.committedAt, window.end)
            )
          )
          .orderBy(asc(commits.committedAt)),
        this.db
          .select({
            day: healthDailySummaries.day,
            metric: healthDailySummaries.metric,
            valueAvg: healthDailySummaries.valueAvg,
            valueMin: healthDailySummaries.valueMin,
            valueMax: healthDailySummaries.valueMax,
            valueSum: healthDailySummaries.valueSum,
            count: healthDailySummaries.count,
          })
          .from(healthDailySummaries)
          .where(
            and(
              eq(healthDailySummaries.userId, userId),
              gte(healthDailySummaries.day, trip.startDate),
              lt(healthDailySummaries.day, window.endExclusiveDate)
            )
          )
          .orderBy(asc(healthDailySummaries.day), asc(healthDailySummaries.metric)),
      ]);

    const modeMap = new Map<
      string,
      { distanceMeters: number; durationSeconds: number; segmentCount: number }
    >();
    for (const row of transportRows) {
      const aggregate = modeMap.get(row.mode) ?? {
        distanceMeters: 0,
        durationSeconds: 0,
        segmentCount: 0,
      };
      aggregate.distanceMeters += row.distanceMeters;
      aggregate.durationSeconds += row.durationSeconds;
      aggregate.segmentCount += 1;
      modeMap.set(row.mode, aggregate);
    }
    const modes = [...modeMap.entries()]
      .map(([mode, aggregate]) => ({ mode, ...aggregate }))
      .sort((a, b) => b.distanceMeters - a.distanceMeters || a.mode.localeCompare(b.mode));

    const currentCodingSeconds = codingRows
      .filter((row) => row.date >= trip.startDate)
      .reduce((sum, row) => sum + row.totalSeconds, 0);
    const previousCodingRows = codingRows.filter((row) => row.date < trip.startDate);
    const previousCodingSeconds = previousCodingRows.reduce(
      (sum, row) => sum + row.totalSeconds,
      0
    );
    const currentCommits = commitRows.filter(
      (row) => row.committedAt.getTime() >= window.start.getTime()
    );
    const previousCommits = commitRows.filter(
      (row) => row.committedAt.getTime() < window.start.getTime()
    );
    const hasPreviousRoutineData = previousCodingRows.length > 0 || previousCommits.length > 0;

    return {
      trip,
      visits: visitRows,
      spending: aggregateSpending(transactionRows, window.dayCount),
      transport: {
        totalDistanceMeters: modes.reduce((sum, mode) => sum + mode.distanceMeters, 0),
        modes,
      },
      routine: {
        codingSeconds: currentCodingSeconds,
        commitCount: currentCommits.length,
        comparison: hasPreviousRoutineData
          ? {
              codingSeconds: previousCodingSeconds,
              commitCount: previousCommits.length,
              codingPercentChange:
                previousCodingSeconds > 0
                  ? Math.round(
                      ((currentCodingSeconds - previousCodingSeconds) / previousCodingSeconds) * 100
                    )
                  : null,
              commitPercentChange:
                previousCommits.length > 0
                  ? Math.round(
                      ((currentCommits.length - previousCommits.length) / previousCommits.length) *
                        100
                    )
                  : null,
            }
          : null,
      },
      health: healthRows,
    };
  }
}
