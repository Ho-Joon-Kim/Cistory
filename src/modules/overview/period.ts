import type { PeriodSnapshotStatus, PeriodType } from "@/db/schema";
import { startOfLocalDay, toLocalDateString } from "@/lib/utils";

export type { PeriodSnapshotStatus, PeriodType } from "@/db/schema";

export const periodTypes = [
  "recent",
  "week",
  "month",
  "year",
] as const satisfies readonly PeriodType[];

export interface PeriodRange {
  from: Date;
  toExclusive: Date;
}

export interface PeriodSnapshotLeaseState {
  status: PeriodSnapshotStatus;
  computeStartedAt: Date | null;
  leaseExpiresAt: Date | null;
  attemptCount: number;
}

type RecoveredLease<T extends PeriodSnapshotLeaseState> = Omit<
  T,
  "status" | "computeStartedAt" | "leaseExpiresAt"
> &
  PeriodSnapshotLeaseState;

function addLocalDays(date: Date, days: number): Date {
  return startOfLocalDay(
    toLocalDateString(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days))
  );
}

function parseLocalDateKey(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid local date key: ${value}`);
  }

  const date = startOfLocalDay(value);
  if (toLocalDateString(date) !== value) {
    throw new Error(`Invalid local date key: ${value}`);
  }
  return date;
}

function getIsoWeek(date: Date): { year: number; week: number; monday: Date } {
  const localDay = startOfLocalDay(toLocalDateString(date));
  const isoDay = localDay.getDay() || 7;
  const monday = addLocalDays(localDay, 1 - isoDay);
  const thursday = addLocalDays(monday, 3);
  const year = thursday.getFullYear();
  const januaryFourth = startOfLocalDay(`${year}-01-04`);
  const firstIsoMonday = addLocalDays(januaryFourth, 1 - (januaryFourth.getDay() || 7));
  const week = Math.round((monday.getTime() - firstIsoMonday.getTime()) / 604_800_000) + 1;

  return { year, week, monday };
}

function getIsoWeekRange(periodKey: string): PeriodRange {
  const match = /^(\d{4})-W(\d{2})$/.exec(periodKey);
  if (!match) {
    throw new Error(`Invalid ISO week key: ${periodKey}`);
  }

  const year = Number(match[1]);
  const week = Number(match[2]);
  const januaryFourth = startOfLocalDay(`${year}-01-04`);
  const firstIsoMonday = addLocalDays(januaryFourth, 1 - (januaryFourth.getDay() || 7));
  const from = addLocalDays(firstIsoMonday, (week - 1) * 7);

  if (week < 1 || getPeriodKey("week", from) !== periodKey) {
    throw new Error(`Invalid ISO week key: ${periodKey}`);
  }

  return { from, toExclusive: addLocalDays(from, 7) };
}

export function getPeriodKey(periodType: PeriodType, date: Date): string {
  const localDate = toLocalDateString(date);

  switch (periodType) {
    case "recent":
      return localDate;
    case "week": {
      const { year, week } = getIsoWeek(date);
      return `${year}-W${String(week).padStart(2, "0")}`;
    }
    case "month":
      return localDate.slice(0, 7);
    case "year":
      return localDate.slice(0, 4);
  }
}

export function getPeriodRange(periodType: PeriodType, periodKey: string): PeriodRange {
  switch (periodType) {
    case "recent": {
      const endDate = parseLocalDateKey(periodKey);
      return { from: addLocalDays(endDate, -13), toExclusive: addLocalDays(endDate, 1) };
    }
    case "week":
      return getIsoWeekRange(periodKey);
    case "month": {
      const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
      if (!match) {
        throw new Error(`Invalid month key: ${periodKey}`);
      }
      const year = Number(match[1]);
      const month = Number(match[2]);
      if (month < 1 || month > 12) {
        throw new Error(`Invalid month key: ${periodKey}`);
      }
      return {
        from: startOfLocalDay(`${year}-${String(month).padStart(2, "0")}-01`),
        toExclusive: startOfLocalDay(toLocalDateString(new Date(year, month, 1))),
      };
    }
    case "year": {
      if (!/^\d{4}$/.test(periodKey)) {
        throw new Error(`Invalid year key: ${periodKey}`);
      }
      const year = Number(periodKey);
      return {
        from: startOfLocalDay(`${year}-01-01`),
        toExclusive: startOfLocalDay(`${year + 1}-01-01`),
      };
    }
  }
}

export function isPeriodActive(
  periodType: PeriodType,
  periodKey: string,
  now: Date = new Date()
): boolean {
  const range = getPeriodRange(periodType, periodKey);
  return now >= range.from && now < range.toExclusive;
}

export function recoverExpiredPeriodSnapshotLease<T extends PeriodSnapshotLeaseState>(
  snapshot: T,
  now: Date = new Date()
): RecoveredLease<T> {
  if (
    snapshot.status !== "computing" ||
    snapshot.leaseExpiresAt === null ||
    snapshot.leaseExpiresAt > now
  ) {
    return snapshot;
  }

  return {
    ...snapshot,
    status: "pending",
    computeStartedAt: null,
    leaseExpiresAt: null,
  };
}
