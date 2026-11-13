/**
 * Time handling for MCP tool inputs and outputs.
 *
 * Inputs:
 *  - An instant must be a full ISO 8601 date-time WITH an offset (`Z` or
 *    `±hh:mm`). An offsetless date-time ("2026-11-13T09:00:00") is rejected:
 *    an agent running in another timezone would otherwise be silently shifted.
 *  - A bare `YYYY-MM-DD` is a KST calendar day (Asia/Seoul, UTC+9, no DST),
 *    resolved with explicit `+09:00` arithmetic so the result never depends on
 *    the server process's TZ.
 *  - A range is at most MCP_MAX_RANGE_DAYS long.
 *
 * Outputs: every instant is rendered as ISO 8601 with a `+09:00` offset.
 */

import {
  dateKeyToUtcMillis,
  getKstDateWindow,
  shiftDateKey,
  toKstCalendarDate,
} from "@/lib/date-key";
import { McpInputError } from "./errors";

export const MCP_MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
// Seconds and fractions optional; the offset is not.
const INSTANT =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/i;
const OFFSETLESS = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

function invalidDate(field: string): McpInputError {
  return new McpInputError(
    `${field}: 날짜는 YYYY-MM-DD(한국 시간 하루), 시각은 오프셋이 있는 ISO 8601(예: 2026-11-13T09:00:00+09:00)로 입력하세요.`,
    "invalid_time"
  );
}

/** Whether `value` is a real `YYYY-MM-DD` calendar date. */
export function isDateKey(value: string): boolean {
  return DATE_KEY.test(value) && dateKeyToUtcMillis(value) !== null;
}

/** Parse an instant that carries an explicit offset. */
export function parseInstant(value: string, field = "시각"): Date {
  const trimmed = value.trim();
  if (OFFSETLESS.test(trimmed)) {
    throw new McpInputError(
      `${field}: 시간대 오프셋이 없는 시각은 받지 않습니다. Z 또는 +09:00 같은 오프셋을 붙이세요.`,
      "time_offset_required"
    );
  }
  const match = INSTANT.exec(trimmed);
  if (!match || !isDateKey(match[1])) throw invalidDate(field);
  const [hh, mm, ss] = [Number(match[2]), Number(match[3]), Number(match[4] ?? 0)];
  if (hh > 23 || mm > 59 || ss > 59) throw invalidDate(field);
  const offset = match[5].toUpperCase();
  if (offset !== "Z") {
    const [oh, om] = offset.slice(1).split(":").map(Number);
    if (oh > 14 || om > 59) throw invalidDate(field);
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) throw invalidDate(field);
  return date;
}

/** Start of a KST calendar day as an instant. */
export function kstDayStart(dateKey: string): Date {
  return getKstDateWindow(dateKey, dateKey).start;
}

export type TimeBoundary = "start" | "end";

/**
 * One end of a range. A date key resolves to the KST day's start (`start`)
 * or to the next KST day's start (`end`, exclusive) so the named day is
 * included whole. An instant is used as-is.
 */
export function parseBoundary(value: string, boundary: TimeBoundary, field = "시각"): Date {
  const trimmed = value.trim();
  if (DATE_KEY.test(trimmed)) {
    if (!isDateKey(trimmed)) throw invalidDate(field);
    return boundary === "start" ? kstDayStart(trimmed) : kstDayStart(shiftDateKey(trimmed, 1));
  }
  return parseInstant(trimmed, field);
}

export interface TimeRange {
  /** Inclusive lower bound. */
  start: Date;
  /** Exclusive upper bound. */
  end: Date;
  /** KST day of `start`. */
  fromDate: string;
  /** KST day of the last instant inside the range (`end` − 1 ms). */
  toDate: string;
}

export interface ParseRangeOptions {
  /** Days back from `now`'s KST day when `from` is omitted (inclusive of today). */
  defaultDays?: number;
  maxDays?: number;
  now?: Date;
}

/**
 * Parse an agent `{ from?, to? }` pair. `to` defaults to the end of today
 * (KST); `from` defaults to `defaultDays` KST days ending with `to`'s day.
 * Rejects an empty/inverted range and one longer than `maxDays`.
 */
export function parseTimeRange(
  input: { from?: string | null; to?: string | null },
  options: ParseRangeOptions = {}
): TimeRange {
  const now = options.now ?? new Date();
  const maxDays = options.maxDays ?? MCP_MAX_RANGE_DAYS;
  const defaultDays = options.defaultDays ?? 7;

  const end = input.to
    ? parseBoundary(input.to, "end", "to")
    : kstDayStart(shiftDateKey(toKstCalendarDate(now), 1));
  const start = input.from
    ? parseBoundary(input.from, "start", "from")
    : kstDayStart(shiftDateKey(toKstCalendarDate(new Date(end.getTime() - 1)), 1 - defaultDays));

  if (end.getTime() <= start.getTime()) {
    throw new McpInputError("기간의 끝이 시작보다 늦어야 합니다.", "invalid_range");
  }
  if (end.getTime() - start.getTime() > maxDays * DAY_MS) {
    throw new McpInputError(`기간은 최대 ${maxDays}일까지 조회할 수 있습니다.`, "range_too_long");
  }
  return {
    start,
    end,
    fromDate: toKstCalendarDate(start),
    toDate: toKstCalendarDate(new Date(end.getTime() - 1)),
  };
}

/** Render an instant as ISO 8601 in KST: `2026-11-13T18:00:00+09:00`. */
export function toKstIso(date: Date): string {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS).toISOString();
  return `${shifted.slice(0, 19)}+09:00`;
}

/** Render a nullable instant (null/undefined → null). */
export function toKstIsoOrNull(date: Date | null | undefined): string | null {
  return date ? toKstIso(date) : null;
}

export { toKstCalendarDate as toKstDateKey };
