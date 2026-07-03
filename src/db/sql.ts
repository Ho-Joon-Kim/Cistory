import { type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * `timestamp` (without time zone) columns in this schema hold **UTC wall
 * time** — Drizzle serializes JS Dates via toISOString() on write (verified
 * against live rows: stored values run exactly 9h behind KST clock time).
 *
 * Deriving a calendar day therefore needs an explicit UTC → KST conversion.
 * Both of these are wrong:
 *   - `DATE(col)` — yields the UTC day, so 00:00–09:00 KST lands on the
 *     previous day
 *   - `col AT TIME ZONE 'Asia/Seoul'` — *interprets* the naive value as KST
 *     (wrong direction); combined with a KST session timezone it degenerates
 *     to the UTC day again
 */
export const APP_TIME_ZONE = "Asia/Seoul";

/** KST calendar day of a UTC-wall `timestamp` column/expression, as SQL `date`. */
export function localDaySql(column: PgColumn | SQL): SQL<string> {
  return sql`(${column} at time zone 'UTC' at time zone 'Asia/Seoul')::date`;
}

/**
 * Same conversion for raw-string SQL (db.execute template blocks) where a
 * Drizzle column object isn't in scope. `columnRef` must be a trusted
 * identifier, never user input.
 */
export function localDayRawSql(columnRef: string): string {
  return `(${columnRef} at time zone 'UTC' at time zone 'Asia/Seoul')::date`;
}
