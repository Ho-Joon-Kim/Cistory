import { getDb } from "@/db";
import { commits, codingDailyStats, codingSessions, transactions } from "@/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";

type Database = ReturnType<typeof getDb>;

export interface StreaksResult {
  currentCommitStreak: number;
  maxCommitStreak: number;
  calendar: Record<string, { hasCommit: boolean }>;
}

export interface WorkPatternsResult {
  avgFirstCommitHour: number;
  avgLastCommitHour: number;
  mostProductiveHour: number;
  mostProductiveDay: number;
  nightRatio: number;
  weekendRatio: number;
  totalCommits: number;
}

export interface RoutinePatternsResult {
  dayPatterns: {
    day: number;
    commits: number;
    codingSeconds: number;
    transactions: number;
  }[];
}

export interface MonthlyDigest {
  month: number;
  totalCommits: number;
  totalCodingSeconds: number;
  topProject: string | null;
}

export interface MonthlyDigestsResult {
  months: MonthlyDigest[];
}

export interface CommitHeatmapResult {
  days: { date: string; count: number }[];
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export class InsightsService {
  static async calculateStreaks(
    db: Database,
    userId: string,
    year: number,
  ): Promise<StreaksResult> {
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31, 23, 59, 59);

    const yearCommits = await db
      .select({ committedAt: commits.committedAt })
      .from(commits)
      .where(
        and(
          eq(commits.userId, userId),
          gte(commits.committedAt, startDate),
          lte(commits.committedAt, endDate),
        ),
      );

    const commitDates = new Set<string>();
    for (const c of yearCommits) {
      commitDates.add(toDateKey(c.committedAt));
    }

    const calendar: Record<string, { hasCommit: boolean }> = {};
    const today = new Date();
    const todayStr = toDateKey(today);

    const allDates: string[] = [];
    const cursor = new Date(year, 0, 1);
    while (cursor.getFullYear() === year) {
      const dateStr = toDateKey(cursor);
      allDates.push(dateStr);
      calendar[dateStr] = { hasCommit: commitDates.has(dateStr) };
      cursor.setDate(cursor.getDate() + 1);
    }

    let maxStreak = 0;
    let currentRun = 0;
    for (const dateStr of allDates) {
      if (commitDates.has(dateStr)) {
        currentRun++;
        maxStreak = Math.max(maxStreak, currentRun);
      } else {
        currentRun = 0;
      }
    }

    let currentStreak = 0;
    const todayIndex = allDates.indexOf(todayStr);
    if (todayIndex >= 0) {
      for (let i = todayIndex; i >= 0; i--) {
        if (commitDates.has(allDates[i])) {
          currentStreak++;
        } else {
          break;
        }
      }
    }

    return { currentCommitStreak: currentStreak, maxCommitStreak: maxStreak, calendar };
  }

  static async calculateWorkPatterns(
    db: Database,
    userId: string,
    year: number,
  ): Promise<WorkPatternsResult> {
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31, 23, 59, 59);

    const yearCommits = await db
      .select({ committedAt: commits.committedAt })
      .from(commits)
      .where(
        and(
          eq(commits.userId, userId),
          gte(commits.committedAt, startDate),
          lte(commits.committedAt, endDate),
        ),
      );

    if (yearCommits.length === 0) {
      return {
        avgFirstCommitHour: 0,
        avgLastCommitHour: 0,
        mostProductiveHour: 0,
        mostProductiveDay: 0,
        nightRatio: 0,
        weekendRatio: 0,
        totalCommits: 0,
      };
    }

    const hourCounts = new Array(24).fill(0);
    const dayCounts = new Array(7).fill(0);
    const dailyFirstHour: Record<string, number> = {};
    const dailyLastHour: Record<string, number> = {};
    let nightCount = 0;
    let weekendCount = 0;

    for (const c of yearCommits) {
      const date = c.committedAt;
      const hour = date.getHours();
      const day = date.getDay();
      const dateKey = toDateKey(date);

      hourCounts[hour]++;
      dayCounts[day]++;

      if (dailyFirstHour[dateKey] === undefined || hour < dailyFirstHour[dateKey]) {
        dailyFirstHour[dateKey] = hour;
      }
      if (dailyLastHour[dateKey] === undefined || hour > dailyLastHour[dateKey]) {
        dailyLastHour[dateKey] = hour;
      }

      if (hour >= 22 || hour < 6) nightCount++;
      if (day === 0 || day === 6) weekendCount++;
    }

    const mostProductiveHour = hourCounts.indexOf(Math.max(...hourCounts));
    const mostProductiveDay = dayCounts.indexOf(Math.max(...dayCounts));

    const firstHours = Object.values(dailyFirstHour);
    const lastHours = Object.values(dailyLastHour);
    const avgFirstCommitHour =
      firstHours.length > 0
        ? Math.round((firstHours.reduce((a, b) => a + b, 0) / firstHours.length) * 10) / 10
        : 0;
    const avgLastCommitHour =
      lastHours.length > 0
        ? Math.round((lastHours.reduce((a, b) => a + b, 0) / lastHours.length) * 10) / 10
        : 0;

    return {
      avgFirstCommitHour,
      avgLastCommitHour,
      mostProductiveHour,
      mostProductiveDay,
      nightRatio: Math.round((nightCount / yearCommits.length) * 100) / 100,
      weekendRatio: Math.round((weekendCount / yearCommits.length) * 100) / 100,
      totalCommits: yearCommits.length,
    };
  }

  static async calculateRoutinePatterns(
    db: Database,
    userId: string,
    year: number,
  ): Promise<RoutinePatternsResult> {
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31, 23, 59, 59);

    const yearCommits = await db
      .select({ committedAt: commits.committedAt })
      .from(commits)
      .where(
        and(
          eq(commits.userId, userId),
          gte(commits.committedAt, startDate),
          lte(commits.committedAt, endDate),
        ),
      );

    const commitDayCounts = new Array(7).fill(0);
    for (const c of yearCommits) {
      commitDayCounts[c.committedAt.getDay()]++;
    }

    // Coding sessions by day of week
    const codingDayCounts = new Array(7).fill(0);
    try {
      const yearCoding = await db
        .select({ startedAt: codingSessions.startedAt, durationSeconds: codingSessions.durationSeconds })
        .from(codingSessions)
        .where(
          and(
            eq(codingSessions.userId, userId),
            gte(codingSessions.startedAt, startDate),
            lte(codingSessions.startedAt, endDate),
          ),
        );
      for (const c of yearCoding) {
        codingDayCounts[c.startedAt.getDay()] += c.durationSeconds;
      }
    } catch {
      // codingSessions table may not have data
    }

    // Transactions by day of week
    const txDayCounts = new Array(7).fill(0);
    try {
      const yearTx = await db
        .select({ transactedAt: transactions.transactedAt })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            gte(transactions.transactedAt, startDate),
            lte(transactions.transactedAt, endDate),
          ),
        );
      for (const t of yearTx) {
        txDayCounts[t.transactedAt.getDay()]++;
      }
    } catch {
      // transactions table may not have data
    }

    const dayPatterns = commitDayCounts.map((count: number, day: number) => ({
      day,
      commits: count,
      codingSeconds: codingDayCounts[day],
      transactions: txDayCounts[day],
    }));

    return { dayPatterns };
  }

  static async calculateMonthlyDigests(
    db: Database,
    userId: string,
    year: number,
  ): Promise<MonthlyDigestsResult> {
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31, 23, 59, 59);

    const yearCommits = await db
      .select({ committedAt: commits.committedAt, repoFullName: commits.repoFullName })
      .from(commits)
      .where(
        and(
          eq(commits.userId, userId),
          gte(commits.committedAt, startDate),
          lte(commits.committedAt, endDate),
        ),
      );

    const monthData: Record<number, { count: number; repoCounts: Record<string, number>; codingSeconds: number }> = {};
    for (let m = 1; m <= 12; m++) {
      monthData[m] = { count: 0, repoCounts: {}, codingSeconds: 0 };
    }

    for (const c of yearCommits) {
      const month = c.committedAt.getMonth() + 1;
      if (monthData[month]) {
        monthData[month].count++;
        const repo = c.repoFullName;
        monthData[month].repoCounts[repo] = (monthData[month].repoCounts[repo] || 0) + 1;
      }
    }

    // Coding stats per month (date is text "YYYY-MM-DD")
    try {
      const yearStr = String(year);
      const codingStats = await db
        .select({ date: codingDailyStats.date, totalSeconds: codingDailyStats.totalSeconds })
        .from(codingDailyStats)
        .where(
          and(
            eq(codingDailyStats.userId, userId),
            gte(codingDailyStats.date, `${yearStr}-01-01`),
            lte(codingDailyStats.date, `${yearStr}-12-31`),
          ),
        );
      for (const s of codingStats) {
        const month = parseInt(s.date.split("-")[1], 10);
        if (monthData[month]) {
          monthData[month].codingSeconds += s.totalSeconds;
        }
      }
    } catch {
      // codingDailyStats may not have data
    }

    const months: MonthlyDigest[] = [];
    for (let m = 1; m <= 12; m++) {
      const data = monthData[m];
      let topProject: string | null = null;
      if (data.count > 0) {
        const entries = Object.entries(data.repoCounts).sort((a, b) => b[1] - a[1]);
        if (entries.length > 0) {
          const parts = entries[0][0].split("/");
          topProject = parts.length > 1 ? parts[1] : entries[0][0];
        }
      }
      months.push({ month: m, totalCommits: data.count, totalCodingSeconds: data.codingSeconds, topProject });
    }

    return { months };
  }

  static async getCommitHeatmapData(
    db: Database,
    userId: string,
    year: number,
  ): Promise<CommitHeatmapResult> {
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31, 23, 59, 59);

    const yearCommits = await db
      .select({ committedAt: commits.committedAt })
      .from(commits)
      .where(
        and(
          eq(commits.userId, userId),
          gte(commits.committedAt, startDate),
          lte(commits.committedAt, endDate),
        ),
      );

    const dayCounts: Record<string, number> = {};
    for (const c of yearCommits) {
      const dateStr = toDateKey(c.committedAt);
      dayCounts[dateStr] = (dayCounts[dateStr] || 0) + 1;
    }

    return {
      days: Object.entries(dayCounts).map(([date, count]) => ({ date, count })),
    };
  }
}
