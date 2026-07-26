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

/**
 * Serialize a JS `Date` for a raw `sql` template the same way the query builder
 * would for that column.
 *
 * A Date interpolated directly into a `sql` template bypasses Drizzle's column
 * mapping and reaches node-postgres as a Date object, which serializes it in
 * the **process timezone** (`TZ=Asia/Seoul` in production). The query builder
 * instead maps it to UTC wall time. Mixing the two writes KST and UTC values
 * into the same column nine hours apart, which silently breaks equality guards
 * and `<=` lease comparisons across the two code paths.
 *
 * Always wrap Dates going into raw SQL:
 *   sql`... SET lease_expires_at = ${timestampParam(table.leaseExpiresAt, at)}`
 */
export function timestampParam(column: PgColumn, value: Date): string {
  return column.mapToDriverValue(value) as string;
}

/**
 * Parse a Drizzle `numeric` column (serialized to a string on read) into a
 * number, preserving null. Integer columns already arrive as numbers and don't
 * need this.
 */
export function numericToNumber(v: string | null): number | null {
  return v == null ? null : Number(v);
}
