import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { accountRoles, codingDailyStats, commits, transactions, users } from "@/db/schema";
import { accountRolesJoinOn, bucketSql } from "@/modules/spending/classify";

// ── Helpers ────────────────────────────────────────────────────────────────

function toDateKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function yearRange(year: number) {
  return {
    start: new Date(year, 0, 1),
    end: new Date(year, 11, 31, 23, 59, 59),
  };
}

// ── Result Types ───────────────────────────────────────────────────────────

export interface StreaksResult {
  currentCommitStreak: number;
  maxCommitStreak: number;
  calendar: Record<string, { hasCommit: boolean }>;
}

export interface WorkPatternsResult {
  avgFirstCommitHour: number | null;
  avgLastCommitHour: number | null;
  mostProductiveHour: number | null;
  mostProductiveDay: number | null;
  nightRatio: number;
  weekendRatio: number;
  hourDistribution: number[];
}

export interface RoutinePatternsResult {
  dayPatterns: {
    day: number;
    commits: number;
    codingSeconds: number;
    transactions: number;
  }[];
}

export interface MonthlyDigestsResult {
  months: {
    month: number;
    totalCommits: number;
    totalCodingSeconds: number;
    topProject: string | null;
  }[];
}

export interface CommitHeatmapResult {
  days: { date: string; count: number }[];
}

// ── Service ────────────────────────────────────────────────────────────────

// biome-ignore lint/complexity/noStaticOnlyClass: namespace-style grouping for service methods; scheduled to convert to plain functions in Phase 6 refactor
export class InsightsService {
  /**
   * Calculate current/max commit streaks and a calendar of active days for the year.
   */
  static async calculateStreaks(
    db: Database,
    userId: string,
    year: number
  ): Promise<StreaksResult> {
    const { start, end } = yearRange(year);

    const rows = await db
      .select({ committedAt: commits.committedAt })
      .from(commits)
      .where(
        and(
          eq(commits.userId, userId),
          gte(commits.committedAt, start),
          lte(commits.committedAt, end)
        )
      );

    // Build set of active dates
    const activeDates = new Set<string>();
    for (const row of rows) {
      activeDates.add(toDateKey(row.committedAt));
    }

    // Build calendar
    const calendar: Record<string, { hasCommit: boolean }> = {};
    const cursor = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);
    while (cursor <= endDate) {
      const key = toDateKey(cursor);
      calendar[key] = { hasCommit: activeDates.has(key) };
      cursor.setDate(cursor.getDate() + 1);
    }

    // Walk all dates in the year to find streaks
    let currentStreak = 0;
    let maxStreak = 0;
    let runningStreak = 0;

    const today = toDateKey(new Date());

    const walker = new Date(year, 0, 1);
    while (walker <= endDate) {
      const key = toDateKey(walker);
      if (activeDates.has(key)) {
        runningStreak++;
        if (runningStreak > maxStreak) maxStreak = runningStreak;
      } else {
        runningStreak = 0;
      }

      // Current streak: must include today (or the latest active day up to today)
      if (key <= today) {
        if (activeDates.has(key)) {
          currentStreak = runningStreak;
        } else {
          currentStreak = 0;
        }
      }

      walker.setDate(walker.getDate() + 1);
    }

    return { currentCommitStreak: currentStreak, maxCommitStreak: maxStreak, calendar };
  }

  /**
   * Analyze work patterns from commit timestamps.
   */
  static async calculateWorkPatterns(
    db: Database,
    userId: string,
    year: number
  ): Promise<WorkPatternsResult> {
    const { start, end } = yearRange(year);

    const rows = await db
      .select({ committedAt: commits.committedAt })
      .from(commits)
      .where(
        and(
          eq(commits.userId, userId),
          gte(commits.committedAt, start),
          lte(commits.committedAt, end)
        )
      );

    if (rows.length === 0) {
      return {
        avgFirstCommitHour: null,
        avgLastCommitHour: null,
        mostProductiveHour: null,
        mostProductiveDay: null,
        nightRatio: 0,
        weekendRatio: 0,
        hourDistribution: new Array(24).fill(0),
      };
    }

    // Group commits by date, track hours
    const hourCounts = new Array(24).fill(0);
    const dayCounts = new Array(7).fill(0); // 0=Sun, 6=Sat
    const dateFirstHour: Record<string, number> = {};
    const dateLastHour: Record<string, number> = {};
    let nightCount = 0; // 22:00 ~ 05:59
    let weekendCount = 0;

    for (const row of rows) {
      const d = row.committedAt;
      const hour = d.getHours();
      const day = d.getDay();
      const key = toDateKey(d);

      hourCounts[hour]++;
      dayCounts[day]++;

      if (hour >= 22 || hour < 6) nightCount++;
      if (day === 0 || day === 6) weekendCount++;

      if (dateFirstHour[key] === undefined || hour < dateFirstHour[key]) {
        dateFirstHour[key] = hour;
      }
      if (dateLastHour[key] === undefined || hour > dateLastHour[key]) {
        dateLastHour[key] = hour;
      }
    }

    const total = rows.length;
    const dates = Object.keys(dateFirstHour);
    const avgFirstCommitHour =
      dates.length > 0
        ? Math.round(dates.reduce((s, k) => s + dateFirstHour[k], 0) / dates.length)
        : null;
    const avgLastCommitHour =
      dates.length > 0
        ? Math.round(dates.reduce((s, k) => s + dateLastHour[k], 0) / dates.length)
        : null;

    const mostProductiveHour = hourCounts.indexOf(Math.max(...hourCounts));
    const mostProductiveDay = dayCounts.indexOf(Math.max(...dayCounts));

    return {
      avgFirstCommitHour,
      avgLastCommitHour,
      mostProductiveHour,
      mostProductiveDay,
      nightRatio: total > 0 ? nightCount / total : 0,
      weekendRatio: total > 0 ? weekendCount / total : 0,
      hourDistribution: hourCounts,
    };
  }

  /**
   * Aggregate activity by day-of-week: commits, coding seconds, and transactions.
   */
  static async calculateRoutinePatterns(
    db: Database,
    userId: string,
    year: number
  ): Promise<RoutinePatternsResult> {
    const { start, end } = yearRange(year);
    const startStr = `${year}-01-01`;
    const endStr = `${year}-12-31`;

    // Commits by day of week
    const commitRows = await db
      .select({ committedAt: commits.committedAt })
      .from(commits)
      .where(
        and(
          eq(commits.userId, userId),
          gte(commits.committedAt, start),
          lte(commits.committedAt, end)
        )
      );

    const dayCommits = new Array(7).fill(0);
    for (const r of commitRows) {
      dayCommits[r.committedAt.getDay()]++;
    }

    // Coding seconds by day of week (from codingDailyStats, text date)
    const codingRows = await db
      .select({
        date: codingDailyStats.date,
        totalSeconds: codingDailyStats.totalSeconds,
      })
      .from(codingDailyStats)
      .where(
        and(
          eq(codingDailyStats.userId, userId),
          gte(codingDailyStats.date, startStr),
          lte(codingDailyStats.date, endStr)
        )
      );

    const dayCoding = new Array(7).fill(0);
    for (const r of codingRows) {
      // Parse "YYYY-MM-DD" safely as local date
      const [y, m, d] = r.date.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      dayCoding[dt.getDay()] += r.totalSeconds;
    }

    // Transactions by day of week. Exclude rows whose classification bucket is
    // 'ignore' (e.g. withdrawals from a 모임통장 marked as a spending account).
    const [userRow] = await db
      .select({ tossMyName: users.tossMyName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const tossMyName = userRow?.tossMyName ?? null;
    const bucket = bucketSql(tossMyName);
    const txRows = await db
      .select({ transactedAt: transactions.transactedAt })
      .from(transactions)
      .leftJoin(accountRoles, accountRolesJoinOn)
      .where(
        and(
          eq(transactions.userId, userId),
          gte(transactions.transactedAt, start),
          lte(transactions.transactedAt, end),
          sql`${bucket} <> 'ignore'`
        )
      );

    const dayTx = new Array(7).fill(0);
    for (const r of txRows) {
      dayTx[r.transactedAt.getDay()]++;
    }

    const dayPatterns = Array.from({ length: 7 }, (_, i) => ({
      day: i,
      commits: dayCommits[i],
      codingSeconds: dayCoding[i],
      transactions: dayTx[i],
    }));

    return { dayPatterns };
  }

  /**
   * Monthly digests: per-month commit count, coding seconds, and top project.
   */
  static async calculateMonthlyDigests(
    db: Database,
    userId: string,
    year: number
  ): Promise<MonthlyDigestsResult> {
    const { start, end } = yearRange(year);
    const startStr = `${year}-01-01`;
    const endStr = `${year}-12-31`;

    // Commits per month
    const commitRows = await db
      .select({ committedAt: commits.committedAt })
      .from(commits)
      .where(
        and(
          eq(commits.userId, userId),
          gte(commits.committedAt, start),
          lte(commits.committedAt, end)
        )
      );

    const monthCommits = new Array(12).fill(0);
    for (const r of commitRows) {
      monthCommits[r.committedAt.getMonth()]++;
    }

    // Coding per month (from codingDailyStats)
    const codingRows = await db
      .select({
        date: codingDailyStats.date,
        totalSeconds: codingDailyStats.totalSeconds,
        projects: codingDailyStats.projects,
      })
      .from(codingDailyStats)
      .where(
        and(
          eq(codingDailyStats.userId, userId),
          gte(codingDailyStats.date, startStr),
          lte(codingDailyStats.date, endStr)
        )
      );

    const monthCoding = new Array(12).fill(0);
    const monthProjectMap: Record<string, number>[] = Array.from({ length: 12 }, () => ({}));

    for (const r of codingRows) {
      const [_y, m] = r.date.split("-").map(Number);
      const monthIdx = m - 1;
      monthCoding[monthIdx] += r.totalSeconds;

      if (r.projects) {
        try {
          const projects = JSON.parse(r.projects) as { name: string; totalSeconds: number }[];
          for (const p of projects) {
            monthProjectMap[monthIdx][p.name] =
              (monthProjectMap[monthIdx][p.name] || 0) + p.totalSeconds;
          }
        } catch {
          // skip malformed JSON
        }
      }
    }

    const months = Array.from({ length: 12 }, (_, i) => {
      const projectMap = monthProjectMap[i];
      let topProject: string | null = null;
      let maxSeconds = 0;
      for (const [name, secs] of Object.entries(projectMap)) {
        if (secs > maxSeconds) {
          maxSeconds = secs;
          topProject = name;
        }
      }

      return {
        month: i + 1,
        totalCommits: monthCommits[i],
        totalCodingSeconds: monthCoding[i],
        topProject,
      };
    });

    return { months };
  }

  /**
   * Daily commit counts for heatmap visualization.
   */
  static async getCommitHeatmapData(
    db: Database,
    userId: string,
    year: number
  ): Promise<CommitHeatmapResult> {
    const { start, end } = yearRange(year);

    const rows = await db
      .select({ committedAt: commits.committedAt })
      .from(commits)
      .where(
        and(
          eq(commits.userId, userId),
          gte(commits.committedAt, start),
          lte(commits.committedAt, end)
        )
      );

    const dateCounts: Record<string, number> = {};
    for (const r of rows) {
      const key = toDateKey(r.committedAt);
      dateCounts[key] = (dateCounts[key] || 0) + 1;
    }

    // Build full year array
    const days: { date: string; count: number }[] = [];
    const cursor = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);
    while (cursor <= endDate) {
      const key = toDateKey(cursor);
      days.push({ date: key, count: dateCounts[key] || 0 });
      cursor.setDate(cursor.getDate() + 1);
    }

    return { days };
  }
}
