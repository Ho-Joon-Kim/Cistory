/**
 * Overview invalidation for user corrections (transaction category/override,
 * trip create/update/not-a-trip). Called by the service write itself, inside
 * its transaction, so the web routes and the MCP tools can't diverge: the
 * correction and the "recompute these periods" mark commit or roll back
 * together.
 *
 * Only `period_snapshots` are re-queued (`narratives: false`): a correction
 * must not discard and regenerate the stored AI narratives (an Opus call each).
 */

import type { Database } from "@/db";
import { dateKeyToUtcMillis, shiftDateKey, toKstCalendarDate } from "@/lib/date-key";
import { invalidateRecoveredPeriods } from "@/modules/data-status/recovery";

export interface DayRange {
  from: string;
  to: string;
}

function isDateKey(value: unknown): value is string {
  return typeof value === "string" && dateKeyToUtcMillis(value) !== null;
}

/**
 * Normalize (swap reversed bounds), drop ranges that aren't real date keys
 * (trip dates are free text columns), and merge overlapping/adjacent ranges.
 */
function validRange(range: { from: unknown; to: unknown }): DayRange | null {
  if (!isDateKey(range.from) || !isDateKey(range.to)) return null;
  return range.from <= range.to
    ? { from: range.from, to: range.to }
    : { from: range.to, to: range.from };
}

export function normalizeDayRanges(
  ranges: ReadonlyArray<{ from: unknown; to: unknown }>
): DayRange[] {
  const valid = ranges
    .map(validRange)
    .filter((range): range is DayRange => range !== null)
    .sort((a, b) => a.from.localeCompare(b.from));
  const merged: DayRange[] = [];
  for (const range of valid) {
    const last = merged.at(-1);
    // Overlapping or adjacent (next day) ranges collapse into one update.
    if (last && range.from <= shiftDateKey(last.to, 1)) {
      if (range.to > last.to) last.to = range.to;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/** Re-queue every overview snapshot covering any of `ranges` (KST day keys). */
export async function invalidateOverviewDays(
  tx: Pick<Database, "update">,
  userId: string,
  ranges: ReadonlyArray<{ from: unknown; to: unknown }>,
  now: Date = new Date()
): Promise<void> {
  for (const range of normalizeDayRanges(ranges)) {
    await invalidateRecoveredPeriods(tx, userId, range.from, range.to, now, {
      narratives: false,
    });
  }
}

/** The KST day of a transaction instant, as a one-day range. */
export function transactionDayRange(transactedAt: Date | null | undefined): DayRange[] {
  if (!(transactedAt instanceof Date) || Number.isNaN(transactedAt.getTime())) return [];
  const day = toKstCalendarDate(transactedAt);
  return [{ from: day, to: day }];
}
