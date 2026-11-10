/**
 * Display formatters for the redesign. One vocabulary across every page:
 *
 * - Money: `2,083,890원` (never ₩). Compact (|n| ≥ 1만): `541.7만원` — one decimal,
 *   no space, a trailing `.0` dropped (`30만원`).
 * - Dates: `11월 9일 (월)`; another year → `2025년 3월 9일 (일)`; ranges
 *   `10월 11일–11월 9일` / same month `10월 1일–31일`; times `21:28` (24h, KST);
 *   recency `방금 · 35분 전 · 7시간 전 · 64일 전`.
 * - Ratios: integer `42%`; market returns keep two decimals with an explicit
 *   sign `−2.67%`.
 * - Signs: U+2212 (−) for negatives. Color follows {@link signTone}: red/blue
 *   only for market returns and investment deltas; cash flow stays ink.
 *
 * Every date function treats a `YYYY-MM-DD` string as a KST calendar day and a
 * `Date` as an instant rendered in Asia/Seoul, so output never depends on the
 * runtime's timezone.
 */
import { toKstCalendarDate } from "@/lib/date-key";

export const MINUS = "−";

const intFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

function signPrefix(n: number, sign: boolean): string {
  if (n < 0) return MINUS;
  if (sign && n > 0) return "+";
  return "";
}

/** `4,673` — grouped integer, with a true minus sign for negatives. */
export function formatCount(n: number, options: { sign?: boolean } = {}): string {
  const rounded = Math.round(n);
  return `${signPrefix(rounded, options.sign ?? false)}${intFormatter.format(Math.abs(rounded))}`;
}

/** `2,083,890원`; `{ sign: true }` → `+30,000원` / `−16,400원`. */
export function formatWon(n: number, options: { sign?: boolean } = {}): string {
  return `${formatCount(n, options)}원`;
}

/**
 * Compact money: below 1만 the full value (`9,280원`); from 1만 up one decimal of
 * 만원 (`541.7만원`, `5,234.4만원`). Use the full {@link formatWon} in tooltips.
 */
export function formatWonCompact(n: number, options: { sign?: boolean } = {}): string {
  const abs = Math.abs(n);
  if (Math.round(abs) < 10_000) return formatWon(n, options);
  const man = Math.round(abs / 1_000) / 10; // one decimal of 만
  const prefix = signPrefix(n, options.sign ?? false);
  return `${prefix}${oneDecimal.format(man)}만원`;
}

/** Splits a compact amount into number + unit for HeroNumber-style rendering. */
export function splitWonCompact(n: number): { value: string; unit: string } {
  const text = formatWonCompact(n);
  const match = /^(.*?)(만원|원)$/.exec(text);
  return match ? { value: match[1], unit: match[2] } : { value: text, unit: "" };
}

/** Integer share of a ratio: `0.4196` → `42%`; a non-zero sliver `0.003` → `<1%`
 * (never a misleading `0%` next to a real amount). */
export function formatShare(ratio: number): string {
  const pct = Math.round(ratio * 100);
  if (pct === 0 && ratio > 0) return "<1%";
  return `${pct}%`;
}

/**
 * Change in percent from a ratio, integer, signed: `0.058` → `+6%`.
 * Use with words ("9월보다 6% 많음") via {@link formatShare} on `Math.abs` instead
 * when the direction is already spelled out.
 */
export function formatDeltaPercent(ratio: number): string {
  const pct = Math.round(ratio * 100);
  return `${signPrefix(pct, true)}${Math.abs(pct)}%`;
}

/** Market return, two decimals, always signed: `-0.0267` → `−2.67%`. */
export function formatReturn(ratio: number): string {
  const pct = Math.round(ratio * 10_000) / 100;
  return `${signPrefix(pct, true)}${Math.abs(pct).toFixed(2)}%`;
}

export type SignDomain = "market" | "cash";
export type SignTone = "gain" | "loss" | "ink";

/**
 * The sign-color rule. `market` (returns, investment value changes): positive →
 * `gain` (red), negative → `loss` (blue). `cash` (spending, income, savings):
 * always `ink` — the sign is written out instead, and income is never green.
 */
export function signTone(value: number, domain: SignDomain): SignTone {
  if (domain === "cash" || value === 0 || !Number.isFinite(value)) return "ink";
  return value > 0 ? "gain" : "loss";
}

/** Tailwind text class for {@link signTone}. */
export function signToneClass(value: number, domain: SignDomain): string {
  const tone = signTone(value, domain);
  return tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : "text-ink";
}

// ── Dates ────────────────────────────────────────────────────────────────────

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export type DateInput = string | Date;

interface DayParts {
  year: number;
  month: number;
  day: number;
  weekday: string;
}

function toDateKey(input: DateInput): string {
  if (typeof input === "string") {
    if (!DATE_KEY.test(input)) throw new Error(`Invalid date key: ${input}`);
    return input;
  }
  return toKstCalendarDate(input);
}

function dayParts(input: DateInput): DayParts {
  const key = toDateKey(input);
  const [, y, m, d] = DATE_KEY.exec(key) as RegExpExecArray;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return { year, month, day, weekday };
}

function currentYear(now: Date): number {
  return dayParts(now).year;
}

export interface DateFormatOptions {
  /** Reference "now" for omitting the current year. Defaults to `new Date()`. */
  now?: Date;
  /** Append `(월)`. Defaults to true. */
  weekday?: boolean;
}

/** `11월 9일 (월)`; another year → `2025년 3월 9일 (일)`. */
export function formatDay(input: DateInput, options: DateFormatOptions = {}): string {
  const { year, month, day, weekday } = dayParts(input);
  const showYear = year !== currentYear(options.now ?? new Date());
  const base = `${showYear ? `${year}년 ` : ""}${month}월 ${day}일`;
  return options.weekday === false ? base : `${base} (${weekday})`;
}

/** `11월 9일` — {@link formatDay} without the weekday. */
export function formatMonthDay(input: DateInput, options: Omit<DateFormatOptions, "weekday"> = {}) {
  return formatDay(input, { ...options, weekday: false });
}

/**
 * `10월 11일–11월 9일`; same month `10월 1일–31일`; a single day collapses to
 * {@link formatMonthDay}. The year is written only when it isn't the current
 * one, and then on both ends if the range spans years.
 */
export function formatDateRange(
  from: DateInput,
  to: DateInput,
  options: Omit<DateFormatOptions, "weekday"> = {}
): string {
  const a = dayParts(from);
  const b = dayParts(to);
  const thisYear = currentYear(options.now ?? new Date());
  if (a.year === b.year && a.month === b.month && a.day === b.day) {
    return formatMonthDay(from, options);
  }
  if (a.year !== b.year) {
    return `${a.year}년 ${a.month}월 ${a.day}일–${b.year}년 ${b.month}월 ${b.day}일`;
  }
  const yearPrefix = a.year !== thisYear ? `${a.year}년 ` : "";
  if (a.month === b.month) return `${yearPrefix}${a.month}월 ${a.day}일–${b.day}일`;
  return `${yearPrefix}${a.month}월 ${a.day}일–${b.month}월 ${b.day}일`;
}

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `21:28` — 24-hour KST clock time of an instant. */
export function formatTime(date: Date): string {
  return timeFormatter.format(date);
}

/** `11월 9일 (월) 21:28` — for tooltips that back a relative time. */
export function formatDateTime(date: Date, options: DateFormatOptions = {}): string {
  return `${formatDay(date, options)} ${formatTime(date)}`;
}

/**
 * Relative recency: `방금` (< 1분), `35분 전`, `7시간 전`, `64일 전`. Future
 * instants (clock skew) read as `방금`. Pair with {@link formatDateTime} in a
 * tooltip for the exact time.
 */
export function formatRelative(input: Date | string, now: Date = new Date()): string {
  const date = typeof input === "string" ? new Date(input) : input;
  const diff = now.getTime() - date.getTime();
  if (!Number.isFinite(diff) || diff < 60_000) return "방금";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

/** `1시간 54분`, `374시간`, `45분` — from minutes. */
export function formatDurationMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}분`;
  if (m === 0 || h >= 100) return `${intFormatter.format(h)}시간`;
  return `${h}시간 ${m}분`;
}
