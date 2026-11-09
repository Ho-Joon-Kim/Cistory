import { formatCount, formatMonthDay } from "@/lib/format";

export interface DailyCommitStat {
  date: string; // KST date key
  count: number;
}

export interface CommitGraphBar {
  date: string;
  count: number;
  /** 0 = none · 1 = 1–30 · 2 = 31–100 · 3 = 101–300 · 4 = 300+ */
  level: 0 | 1 | 2 | 3 | 4;
  /** CSS height (√-scaled against the window max, floor 18%); null for empty days. */
  height: string | null;
  isToday: boolean;
  tip: string;
}

export const COMMIT_GRAPH_DAYS = 28;

export function commitLevel(count: number): CommitGraphBar["level"] {
  if (count <= 0) return 0;
  if (count <= 30) return 1;
  if (count <= 100) return 2;
  if (count <= 300) return 3;
  return 4;
}

/** Bars for the app-bar commit graph: the last 28 days, oldest first. */
export function commitGraphBars(
  stats: DailyCommitStat[],
  todayKey: string,
  now?: Date
): CommitGraphBar[] {
  const window = stats.slice(-COMMIT_GRAPH_DAYS);
  const max = Math.max(1, ...window.map((s) => s.count));
  return window.map(({ date, count }) => ({
    date,
    count,
    level: commitLevel(count),
    height: count > 0 ? `${Math.max(18, Math.round(Math.sqrt(count / max) * 100))}%` : null,
    isToday: date === todayKey,
    tip: `${formatMonthDay(date, { now })} · 커밋 ${formatCount(count)}`,
  }));
}

/** Screen-reader summary: "최근 28일 커밋 2,967건 · 하루 최고 10월 21일 605건 · 오늘 22건". */
export function commitGraphLabel(bars: CommitGraphBar[], now?: Date): string {
  const total = bars.reduce((sum, b) => sum + b.count, 0);
  const parts = [`최근 ${bars.length}일 커밋 ${formatCount(total)}건`];
  const peak = bars.reduce<CommitGraphBar | null>(
    (best, b) => (b.count > 0 && (!best || b.count > best.count) ? b : best),
    null
  );
  if (peak) {
    parts.push(`하루 최고 ${formatMonthDay(peak.date, { now })} ${formatCount(peak.count)}건`);
  }
  const today = bars.find((b) => b.isToday);
  if (today) parts.push(`오늘 ${formatCount(today.count)}건`);
  return parts.join(" · ");
}

/** The bar under a horizontal position on the strip (clamped to the ends). */
export function barIndexAt(
  x: number,
  stripLeft: number,
  stripWidth: number,
  count: number
): number {
  if (count <= 0 || stripWidth <= 0) return 0;
  const i = Math.floor(((x - stripLeft) / stripWidth) * count);
  return Math.min(count - 1, Math.max(0, i));
}
