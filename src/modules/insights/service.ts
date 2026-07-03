import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import type { Database } from "@/db";
import {
  codingDailyStats,
  codingSessions,
  commits,
  dataUsageCache,
  tracks,
  transactions,
  transportationSegments,
  trips,
  visits,
} from "@/db/schema";

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

function dayIndex(d: Date, year: number): number {
  const start = new Date(year, 0, 1);
  return Math.floor((d.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

// ── Existing Result Types (unchanged) ──────────────────────────────────────

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
  dayPatterns: { day: number; commits: number; codingSeconds: number; transactions: number }[];
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

// ── New Result Types (insights redesign) ────────────────────────────────────

export interface SwimlaneResult {
  /** length = days in year */
  commits: number[];
  coding: number[];
  spending: number[];
  visits: number[];
}

export interface AIClockResult {
  /** 24 entries — hour-of-day, additions only (deletions excluded for clarity) */
  hours: { ai: number; human: number }[];
  totalAi: number;
  totalHuman: number;
}

export interface CommuteReliabilityResult {
  /** Buckets: am (출근, 06–11), pm (퇴근, 17–22) */
  am: {
    durationsMin: number[];
    median: number;
    p95: number;
    min: number;
    max: number;
    sample: number;
  };
  pm: {
    durationsMin: number[];
    median: number;
    p95: number;
    min: number;
    max: number;
    sample: number;
  };
}

export interface PlaceProductivityResult {
  places: {
    placeName: string;
    overlapHours: number;
    totalCodingSeconds: number;
    visitCount: number;
  }[];
}

export interface TripsResult {
  totalTrips: number;
  overseasTrips: number;
  domesticTrips: number;
  totalDays: number;
  topDestinations: { name: string; count: number; isOverseas: boolean }[];
}

export interface TransportModesResult {
  /** All transport-mode segments excluding "stationary" */
  modes: {
    mode: string;
    distanceMeters: number;
    durationSeconds: number;
    segmentCount: number;
  }[];
}

export interface VisitsXCommitsResult {
  /** Top places ranked by # of distinct days with both a visit and a commit */
  places: {
    placeName: string;
    daysWithCommits: number;
    totalCommits: number;
    totalVisitHours: number;
  }[];
}

export interface NetSpendResult {
  totalIn: number;
  totalOut: number;
  net: number;
  monthlyOut: number[]; // 12 entries
  monthlyIn: number[]; // 12 entries
  topMerchants: { merchant: string; amount: number; count: number }[];
}

export interface RepoSplitResult {
  totalCommits: number;
  privateCommits: number;
  publicCommits: number;
  topRepos: { fullName: string; commits: number; isPrivate: boolean }[];
}

export interface DataUsageResult {
  totalBytes: number;
  totalRows: number;
  byCategory: { category: string; bytes: number; rows: number }[];
}

export interface DiscoveriesResult {
  bullets: { kind: string; title: string; detail: string }[];
}

// ── Service ────────────────────────────────────────────────────────────────

// biome-ignore lint/complexity/noStaticOnlyClass: namespace-style grouping; existing convention preserved
export class InsightsService {
  // ─── existing methods (unchanged) ─────────────────────────────────────

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

    const activeDates = new Set<string>();
    for (const row of rows) activeDates.add(toDateKey(row.committedAt));

    const calendar: Record<string, { hasCommit: boolean }> = {};
    const cursor = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);
    while (cursor <= endDate) {
      const key = toDateKey(cursor);
      calendar[key] = { hasCommit: activeDates.has(key) };
      cursor.setDate(cursor.getDate() + 1);
    }

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
      if (key <= today) {
        currentStreak = activeDates.has(key) ? runningStreak : 0;
      }
      walker.setDate(walker.getDate() + 1);
    }

    return { currentCommitStreak: currentStreak, maxCommitStreak: maxStreak, calendar };
  }

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

    const hourCounts = new Array(24).fill(0);
    const dayCounts = new Array(7).fill(0);
    const dateFirstHour: Record<string, number> = {};
    const dateLastHour: Record<string, number> = {};
    let nightCount = 0;
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
      if (dateFirstHour[key] === undefined || hour < dateFirstHour[key]) dateFirstHour[key] = hour;
      if (dateLastHour[key] === undefined || hour > dateLastHour[key]) dateLastHour[key] = hour;
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

  static async calculateRoutinePatterns(
    db: Database,
    userId: string,
    year: number
  ): Promise<RoutinePatternsResult> {
    const { start, end } = yearRange(year);
    const startStr = `${year}-01-01`;
    const endStr = `${year}-12-31`;

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
    for (const r of commitRows) dayCommits[r.committedAt.getDay()]++;

    const codingRows = await db
      .select({ date: codingDailyStats.date, totalSeconds: codingDailyStats.totalSeconds })
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
      const [y, m, d] = r.date.split("-").map(Number);
      dayCoding[new Date(y, m - 1, d).getDay()] += r.totalSeconds;
    }

    const txRows = await db
      .select({ transactedAt: transactions.transactedAt })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          gte(transactions.transactedAt, start),
          lte(transactions.transactedAt, end)
        )
      );
    const dayTx = new Array(7).fill(0);
    for (const r of txRows) dayTx[r.transactedAt.getDay()]++;

    return {
      dayPatterns: Array.from({ length: 7 }, (_, i) => ({
        day: i,
        commits: dayCommits[i],
        codingSeconds: dayCoding[i],
        transactions: dayTx[i],
      })),
    };
  }

  static async calculateMonthlyDigests(
    db: Database,
    userId: string,
    year: number
  ): Promise<MonthlyDigestsResult> {
    const { start, end } = yearRange(year);
    const startStr = `${year}-01-01`;
    const endStr = `${year}-12-31`;

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
    for (const r of commitRows) monthCommits[r.committedAt.getMonth()]++;

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
          // skip
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

  // ─── new methods (insights redesign) ──────────────────────────────────

  /**
   * Year swimlane: 4 streams (commits, coding, spending count, visits) bucketed
   * to per-day arrays sized to the year length.
   */
  static async getYearSwimlane(
    db: Database,
    userId: string,
    year: number
  ): Promise<SwimlaneResult> {
    const { start, end } = yearRange(year);
    const startStr = `${year}-01-01`;
    const endStr = `${year}-12-31`;
    const len = daysInYear(year);

    const [commitRows, codingRows, txRows, visitRows] = await Promise.all([
      db
        .select({ committedAt: commits.committedAt })
        .from(commits)
        .where(
          and(
            eq(commits.userId, userId),
            gte(commits.committedAt, start),
            lte(commits.committedAt, end)
          )
        ),
      db
        .select({ date: codingDailyStats.date, totalSeconds: codingDailyStats.totalSeconds })
        .from(codingDailyStats)
        .where(
          and(
            eq(codingDailyStats.userId, userId),
            gte(codingDailyStats.date, startStr),
            lte(codingDailyStats.date, endStr)
          )
        ),
      db
        .select({ transactedAt: transactions.transactedAt })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            gte(transactions.transactedAt, start),
            lte(transactions.transactedAt, end),
            eq(transactions.isSelfTransfer, false)
          )
        ),
      db
        .select({ startTime: visits.startTime })
        .from(visits)
        .where(
          and(eq(visits.userId, userId), gte(visits.startTime, start), lte(visits.startTime, end))
        ),
    ]);

    const cArr = new Array(len).fill(0);
    const codeArr = new Array(len).fill(0);
    const sArr = new Array(len).fill(0);
    const vArr = new Array(len).fill(0);

    for (const r of commitRows) {
      const i = dayIndex(r.committedAt, year);
      if (i >= 0 && i < len) cArr[i]++;
    }
    for (const r of codingRows) {
      const [y, m, d] = r.date.split("-").map(Number);
      const i = dayIndex(new Date(y, m - 1, d), year);
      if (i >= 0 && i < len) codeArr[i] += r.totalSeconds;
    }
    for (const r of txRows) {
      const i = dayIndex(r.transactedAt, year);
      if (i >= 0 && i < len) sArr[i]++;
    }
    for (const r of visitRows) {
      const i = dayIndex(r.startTime, year);
      if (i >= 0 && i < len) vArr[i]++;
    }

    return { commits: cArr, coding: codeArr, spending: sArr, visits: vArr };
  }

  /**
   * 24-hour AI vs human additions clock — sums codingSessions.aiAdditions and
   * humanAdditions per hour-of-day across the year.
   */
  static async getAIClock(db: Database, userId: string, year: number): Promise<AIClockResult> {
    const { start, end } = yearRange(year);
    const rows = await db
      .select({
        startedAt: codingSessions.startedAt,
        humanAdditions: codingSessions.humanAdditions,
        aiAdditions: codingSessions.aiAdditions,
      })
      .from(codingSessions)
      .where(
        and(
          eq(codingSessions.userId, userId),
          gte(codingSessions.startedAt, start),
          lte(codingSessions.startedAt, end)
        )
      );

    const hours = Array.from({ length: 24 }, () => ({ ai: 0, human: 0 }));
    let totalAi = 0;
    let totalHuman = 0;
    for (const r of rows) {
      const h = r.startedAt.getHours();
      const a = r.aiAdditions ?? 0;
      const hu = r.humanAdditions ?? 0;
      hours[h].ai += a;
      hours[h].human += hu;
      totalAi += a;
      totalHuman += hu;
    }
    return { hours, totalAi, totalHuman };
  }

  /**
   * Commute reliability — uses tracks where dominantMode is bike/walk/run as a
   * proxy for personal commutes (excludes train/driving as they're noisier).
   * Splits into AM (06–11) and PM (17–22) windows.
   */
  static async getCommuteReliability(
    db: Database,
    userId: string,
    year: number
  ): Promise<CommuteReliabilityResult> {
    const { start, end } = yearRange(year);
    const rows = await db
      .select({
        startTime: tracks.startTime,
        durationSeconds: tracks.durationSeconds,
        dominantMode: tracks.dominantMode,
      })
      .from(tracks)
      .where(
        and(
          eq(tracks.userId, userId),
          gte(tracks.startTime, start),
          lte(tracks.startTime, end),
          sql`${tracks.dominantMode} IN ('cycling', 'walking', 'running')`
        )
      );

    const am: number[] = [];
    const pm: number[] = [];
    for (const r of rows) {
      const h = r.startTime.getHours();
      const min = r.durationSeconds / 60;
      if (h >= 6 && h <= 11) am.push(min);
      else if (h >= 17 && h <= 22) pm.push(min);
    }

    const summarize = (arr: number[]) => {
      if (arr.length === 0)
        return { durationsMin: arr, median: 0, p95: 0, min: 0, max: 0, sample: 0 };
      const sorted = [...arr].sort((a, b) => a - b);
      const pick = (q: number) =>
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
      return {
        durationsMin: arr,
        median: pick(0.5),
        p95: pick(0.95),
        min: sorted[0],
        max: sorted[sorted.length - 1],
        sample: arr.length,
      };
    };
    return { am: summarize(am), pm: summarize(pm) };
  }

  /**
   * Place × productivity — joins visits with codingSessions on time-overlap;
   * sums coding seconds attributable to each place.
   */
  static async getPlaceProductivity(
    db: Database,
    userId: string,
    year: number
  ): Promise<PlaceProductivityResult> {
    const { start, end } = yearRange(year);

    // Use SQL for the time-overlap join to avoid pulling all rows
    const rows = await db.execute(sql`
      SELECT
        v.place_name AS place_name,
        SUM(
          GREATEST(
            0,
            EXTRACT(EPOCH FROM (
              LEAST(v.end_time, c.started_at + (c.duration_seconds || ' seconds')::interval)
              - GREATEST(v.start_time, c.started_at)
            ))
          )
        )::int AS overlap_seconds,
        COUNT(DISTINCT v.id)::int AS visit_count,
        SUM(c.duration_seconds)::int AS total_coding_seconds
      FROM visits v
      JOIN coding_sessions c
        ON c.user_id = v.user_id
        AND c.started_at < v.end_time
        AND (c.started_at + (c.duration_seconds || ' seconds')::interval) > v.start_time
      WHERE v.user_id = ${userId}
        AND v.start_time >= ${start}
        AND v.start_time <= ${end}
        AND v.place_name IS NOT NULL
      GROUP BY v.place_name
      ORDER BY overlap_seconds DESC
      LIMIT 10
    `);

    const places = (
      rows as unknown as {
        rows: {
          place_name: string;
          overlap_seconds: number;
          visit_count: number;
          total_coding_seconds: number;
        }[];
      }
    ).rows.map((r) => ({
      placeName: r.place_name,
      overlapHours: r.overlap_seconds / 3600,
      totalCodingSeconds: r.total_coding_seconds,
      visitCount: r.visit_count,
    }));

    return { places };
  }

  /**
   * Trips — counts overseas/domestic trips, total travel days, top destinations.
   */
  static async getTrips(db: Database, userId: string, year: number): Promise<TripsResult> {
    const startStr = `${year}-01-01`;
    const endStr = `${year}-12-31`;
    const rows = await db
      .select()
      .from(trips)
      .where(
        and(eq(trips.userId, userId), gte(trips.startDate, startStr), lte(trips.startDate, endStr))
      );

    let overseasTrips = 0;
    let domesticTrips = 0;
    let totalDays = 0;
    const destCounts: Record<string, { count: number; isOverseas: boolean }> = {};

    for (const t of rows) {
      if (t.isOverseas) overseasTrips++;
      else domesticTrips++;

      const [sy, sm, sd] = t.startDate.split("-").map(Number);
      const [ey, em, ed] = t.endDate.split("-").map(Number);
      const days =
        Math.floor(
          (new Date(ey, em - 1, ed).getTime() - new Date(sy, sm - 1, sd).getTime()) /
            (1000 * 60 * 60 * 24)
        ) + 1;
      totalDays += days;

      const list = t.isOverseas ? t.visitedCountries : t.visitedCities;
      if (list) {
        try {
          const arr = JSON.parse(list) as string[];
          for (const name of arr) {
            if (!destCounts[name]) destCounts[name] = { count: 0, isOverseas: t.isOverseas };
            destCounts[name].count++;
          }
        } catch {
          // skip
        }
      }
    }

    const topDestinations = Object.entries(destCounts)
      .map(([name, v]) => ({ name, count: v.count, isOverseas: v.isOverseas }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return {
      totalTrips: rows.length,
      overseasTrips,
      domesticTrips,
      totalDays,
      topDestinations,
    };
  }

  /**
   * Transport modes — sums distance and duration per mode (excluding stationary).
   */
  static async getTransportModes(
    db: Database,
    userId: string,
    year: number
  ): Promise<TransportModesResult> {
    const startStr = `${year}-01-01`;
    const endStr = `${year}-12-31`;
    const rows = await db
      .select({
        mode: transportationSegments.mode,
        distance: transportationSegments.distanceMeters,
        duration: transportationSegments.durationSeconds,
      })
      .from(transportationSegments)
      .where(
        and(
          eq(transportationSegments.userId, userId),
          gte(transportationSegments.date, startStr),
          lte(transportationSegments.date, endStr),
          ne(transportationSegments.mode, "stationary")
        )
      );

    const agg: Record<string, { distance: number; duration: number; count: number }> = {};
    for (const r of rows) {
      if (!agg[r.mode]) agg[r.mode] = { distance: 0, duration: 0, count: 0 };
      agg[r.mode].distance += r.distance;
      agg[r.mode].duration += r.duration;
      agg[r.mode].count++;
    }

    const modes = Object.entries(agg)
      .map(([mode, v]) => ({
        mode,
        distanceMeters: v.distance,
        durationSeconds: v.duration,
        segmentCount: v.count,
      }))
      .sort((a, b) => b.distanceMeters - a.distanceMeters);

    return { modes };
  }

  /**
   * Visits × commits — top places ranked by # of distinct days where the user
   * had both a visit AND a commit. Useful for "where do you actually code?".
   */
  static async getVisitsXCommits(
    db: Database,
    userId: string,
    year: number
  ): Promise<VisitsXCommitsResult> {
    const { start, end } = yearRange(year);
    const rows = await db.execute(sql`
      WITH visit_days AS (
        SELECT
          place_name,
          (start_time at time zone 'UTC' at time zone 'Asia/Seoul')::date AS day,
          SUM(duration_seconds)::int AS total_seconds
        FROM visits
        WHERE user_id = ${userId}
          AND start_time >= ${start}
          AND start_time <= ${end}
          AND place_name IS NOT NULL
        GROUP BY place_name, (start_time at time zone 'UTC' at time zone 'Asia/Seoul')::date
      ),
      commit_days AS (
        SELECT (committed_at at time zone 'UTC' at time zone 'Asia/Seoul')::date AS day,
          COUNT(*)::int AS commit_count
        FROM commits
        WHERE user_id = ${userId}
          AND committed_at >= ${start}
          AND committed_at <= ${end}
        GROUP BY (committed_at at time zone 'UTC' at time zone 'Asia/Seoul')::date
      )
      SELECT
        v.place_name,
        COUNT(DISTINCT v.day)::int AS days_with_commits,
        SUM(c.commit_count)::int AS total_commits,
        SUM(v.total_seconds)::int AS total_visit_seconds
      FROM visit_days v
      JOIN commit_days c ON c.day = v.day
      GROUP BY v.place_name
      ORDER BY days_with_commits DESC
      LIMIT 8
    `);

    const places = (
      rows as unknown as {
        rows: {
          place_name: string;
          days_with_commits: number;
          total_commits: number;
          total_visit_seconds: number;
        }[];
      }
    ).rows.map((r) => ({
      placeName: r.place_name,
      daysWithCommits: r.days_with_commits,
      totalCommits: r.total_commits,
      totalVisitHours: r.total_visit_seconds / 3600,
    }));

    return { places };
  }

  /**
   * Net spend — totals + monthly bars + top merchants. Filters self-transfers.
   */
  static async getNetSpend(db: Database, userId: string, year: number): Promise<NetSpendResult> {
    const { start, end } = yearRange(year);
    const rows = await db
      .select({
        type: transactions.type,
        amount: transactions.amount,
        merchant: transactions.merchant,
        transactedAt: transactions.transactedAt,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          gte(transactions.transactedAt, start),
          lte(transactions.transactedAt, end),
          eq(transactions.isSelfTransfer, false)
        )
      );

    let totalIn = 0;
    let totalOut = 0;
    const monthlyOut = new Array(12).fill(0);
    const monthlyIn = new Array(12).fill(0);
    const merchAgg: Record<string, { amount: number; count: number }> = {};

    for (const r of rows) {
      const m = r.transactedAt.getMonth();
      if (r.type === "withdrawal") {
        totalOut += r.amount;
        monthlyOut[m] += r.amount;
        if (!merchAgg[r.merchant]) merchAgg[r.merchant] = { amount: 0, count: 0 };
        merchAgg[r.merchant].amount += r.amount;
        merchAgg[r.merchant].count++;
      } else {
        totalIn += r.amount;
        monthlyIn[m] += r.amount;
      }
    }

    const topMerchants = Object.entries(merchAgg)
      .map(([merchant, v]) => ({ merchant, amount: v.amount, count: v.count }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6);

    return {
      totalIn,
      totalOut,
      net: totalIn - totalOut,
      monthlyOut,
      monthlyIn,
      topMerchants,
    };
  }

  /**
   * Repo split — total commits broken into private/public, plus top repos.
   */
  static async getRepoSplit(db: Database, userId: string, year: number): Promise<RepoSplitResult> {
    const { start, end } = yearRange(year);
    const rows = await db
      .select({
        repo: commits.repoFullName,
        isPrivate: commits.repoIsPrivate,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(commits)
      .where(
        and(
          eq(commits.userId, userId),
          gte(commits.committedAt, start),
          lte(commits.committedAt, end)
        )
      )
      .groupBy(commits.repoFullName, commits.repoIsPrivate);

    let total = 0;
    let priv = 0;
    let pub = 0;
    const repos: { fullName: string; commits: number; isPrivate: boolean }[] = [];
    for (const r of rows) {
      const c = Number(r.count);
      total += c;
      if (r.isPrivate) priv += c;
      else pub += c;
      repos.push({ fullName: r.repo, commits: c, isPrivate: !!r.isPrivate });
    }

    const topRepos = repos.sort((a, b) => b.commits - a.commits).slice(0, 8);
    return { totalCommits: total, privateCommits: priv, publicCommits: pub, topRepos };
  }

  /**
   * Data usage — totals + per-category breakdown for the user's own footprint.
   */
  static async getDataUsage(db: Database, userId: string): Promise<DataUsageResult> {
    const rows = await db
      .select({
        category: dataUsageCache.category,
        bytes: sql<number>`SUM(${dataUsageCache.estimatedBytes})::int`,
        rows: sql<number>`SUM(${dataUsageCache.rowCount})::int`,
      })
      .from(dataUsageCache)
      .where(eq(dataUsageCache.userId, userId))
      .groupBy(dataUsageCache.category);

    let totalBytes = 0;
    let totalRows = 0;
    const byCategory = rows.map((r) => {
      const b = Number(r.bytes ?? 0);
      const c = Number(r.rows ?? 0);
      totalBytes += b;
      totalRows += c;
      return { category: r.category, bytes: b, rows: c };
    });
    return { totalBytes, totalRows, byCategory };
  }

  /**
   * Discoveries — narrative bullets composed from other section data. Pulls
   * everything in parallel and synthesizes 4 short surprises.
   */
  static async getDiscoveries(
    db: Database,
    userId: string,
    year: number
  ): Promise<DiscoveriesResult> {
    const [patterns, ai, commute, repos] = await Promise.all([
      InsightsService.calculateWorkPatterns(db, userId, year),
      InsightsService.getAIClock(db, userId, year),
      InsightsService.getCommuteReliability(db, userId, year),
      InsightsService.getRepoSplit(db, userId, year),
    ]);

    const bullets: { kind: string; title: string; detail: string }[] = [];

    if (patterns.mostProductiveHour !== null) {
      const h = patterns.mostProductiveHour;
      bullets.push({
        kind: "peak",
        title: `${h}시 피크`,
        detail: `가장 코딩이 많았던 시간대는 ${h}시. 야간 비율 ${Math.round(patterns.nightRatio * 100)}%.`,
      });
    }

    if (ai.totalAi + ai.totalHuman > 0) {
      const ratio = ai.totalAi / (ai.totalAi + ai.totalHuman);
      bullets.push({
        kind: "ai",
        title: `AI ${Math.round(ratio * 100)}%`,
        detail: `올해 추가된 코드 중 ${Math.round(ratio * 100)}%가 AI로부터, ${Math.round((1 - ratio) * 100)}%가 직접 입력.`,
      });
    }

    if (commute.am.sample > 0) {
      bullets.push({
        kind: "commute",
        title: `출근 ${Math.round(commute.am.median)}분`,
        detail: `자전거·도보 출근 ${commute.am.sample}회, 중앙값 ${Math.round(commute.am.median)}분 (p95 ${Math.round(commute.am.p95)}분).`,
      });
    }

    if (repos.totalCommits > 0) {
      const privatePct = Math.round((repos.privateCommits / repos.totalCommits) * 100);
      bullets.push({
        kind: "repos",
        title: `프라이빗 ${privatePct}%`,
        detail: `총 ${repos.totalCommits}커밋 중 ${privatePct}%가 프라이빗 레포. 톱 레포: ${repos.topRepos[0]?.fullName ?? "-"}.`,
      });
    }

    return { bullets };
  }
}
