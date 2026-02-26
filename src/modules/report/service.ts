/**
 * Report Service
 *
 * 월간/연간 보고서 데이터를 실시간(on-the-fly)으로 집계 + AI 내러티브 생성
 * 모든 집계 쿼리는 단일 트랜잭션(=단일 커넥션)으로 실행하여 connection pool 소진 방지
 * 섹션별(commits/coding/location) 독립 집계 메서드를 제공하여 병렬 로딩 지원
 */

import type { Database } from "@/db";
import {
  codingDailyStats,
  codingSessions,
  commitSummaries,
  commits,
  dailyDistances,
  locationPoints,
  placeCache,
  savedPlaces,
} from "@/db/schema";
import { createClaudeAdapter } from "@/lib/adapters/ai/claude";
import { distanceM } from "@/lib/geo";
import { safeJsonParse } from "@/lib/utils";
import { detectCommitType } from "@/modules/summary/prompts";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { buildMonthlyNarrativePrompt, buildYearlyNarrativePrompt } from "./prompts";
import { detectOverseasTrips, isOverseas } from "./travel";
import type {
  CodingSectionData,
  CommitsSectionData,
  ContextSwitchingMetrics,
  CrossAnalysisData,
  DeepWorkSession,
  EnrichedCodingSectionData,
  EnrichedCommitsSectionData,
  EnrichedLocationSectionData,
  LocationSectionData,
  MonthlyReportData,
  PlaceProductivity,
  RoutinePattern,
  SparklineData,
  WorkLifeBalanceMetrics,
  YearlyCodingSectionData,
  YearlyCommitsSectionData,
  YearlyReportData,
} from "./types";

// Drizzle tx has the same query interface as db
type QueryExecutor = Database;

export class ReportService {
  constructor(
    private db: Database,
    private anthropicApiKey?: string
  ) {}

  // ==================== Monthly Section Methods ====================

  async aggregateMonthlyCommits(userId: string, yearMonth: string): Promise<CommitsSectionData> {
    return this.db.transaction(async (tx) => {
      return this._aggregateMonthlyCommits(tx as unknown as QueryExecutor, userId, yearMonth);
    });
  }

  async aggregateMonthlyCoding(userId: string, yearMonth: string): Promise<CodingSectionData> {
    return this.db.transaction(async (tx) => {
      return this._aggregateMonthlyCoding(tx as unknown as QueryExecutor, userId, yearMonth);
    });
  }

  async aggregateMonthlyLocation(userId: string, yearMonth: string): Promise<LocationSectionData> {
    return this.db.transaction(async (tx) => {
      return this._aggregateMonthlyLocation(tx as unknown as QueryExecutor, userId, yearMonth);
    });
  }

  // ==================== Yearly Section Methods ====================

  async aggregateYearlyCommits(userId: string, year: string): Promise<YearlyCommitsSectionData> {
    return this.db.transaction(async (tx) => {
      return this._aggregateYearlyCommits(tx as unknown as QueryExecutor, userId, year);
    });
  }

  async aggregateYearlyCoding(userId: string, year: string): Promise<YearlyCodingSectionData> {
    return this.db.transaction(async (tx) => {
      return this._aggregateYearlyCoding(tx as unknown as QueryExecutor, userId, year);
    });
  }

  async aggregateYearlyLocation(userId: string, year: string): Promise<LocationSectionData> {
    return this.db.transaction(async (tx) => {
      return this._aggregateYearlyLocation(tx as unknown as QueryExecutor, userId, year);
    });
  }

  // ==================== Enriched Monthly Section Methods ====================

  async aggregateEnrichedMonthlyCommits(
    userId: string,
    yearMonth: string
  ): Promise<EnrichedCommitsSectionData> {
    return this.db.transaction(async (tx) => {
      const txq = tx as unknown as QueryExecutor;
      const base = await this._aggregateMonthlyCommits(txq, userId, yearMonth);

      const startDate = this._monthStart(yearMonth);
      const endDate = this._monthEnd(yearMonth);
      const startTs = new Date(startDate);
      const endTs = new Date(endDate);

      const monthCommits = await txq
        .select()
        .from(commits)
        .where(
          and(
            eq(commits.userId, userId),
            gte(commits.committedAt, startTs),
            lt(commits.committedAt, endTs)
          )
        );

      const mergeCommitCount = monthCommits.filter((c) => c.isMergeCommit).length;
      const totalFiles = monthCommits.reduce((s, c) => s + (c.changedFilesCount ?? 0), 0);
      const avgFilesChangedPerCommit =
        monthCommits.length > 0 ? totalFiles / monthCommits.length : 0;

      const workLifeBalance = this._calculateWorkLifeBalance(monthCommits);
      const sparklines = await this._get6MonthSparklines(txq, userId, yearMonth);
      const sameMonthLastYear = await this._getSameMonthLastYearCommits(txq, userId, yearMonth);

      return {
        ...base,
        mergeCommitCount,
        avgFilesChangedPerCommit: Math.round(avgFilesChangedPerCommit * 10) / 10,
        workLifeBalance,
        sparklines: {
          commits: sparklines.commits,
          activeDays: sparklines.activeDays,
        },
        sameMonthLastYear,
      };
    });
  }

  async aggregateEnrichedMonthlyCoding(
    userId: string,
    yearMonth: string
  ): Promise<EnrichedCodingSectionData> {
    return this.db.transaction(async (tx) => {
      const txq = tx as unknown as QueryExecutor;
      const base = await this._aggregateMonthlyCoding(txq, userId, yearMonth);

      const startDate = this._monthStart(yearMonth);
      const endDate = this._monthEnd(yearMonth);
      const startTs = new Date(startDate);
      const endTs = new Date(endDate);

      const { sessions: deepWorkSessions, stats: deepWorkStats } =
        await this._detectDeepWorkSessions(txq, userId, startTs, endTs);

      const codingStats = await txq
        .select()
        .from(codingDailyStats)
        .where(
          and(
            eq(codingDailyStats.userId, userId),
            gte(codingDailyStats.date, startDate),
            lt(codingDailyStats.date, endDate)
          )
        );

      const categoryBreakdown = this._aggregateCategories(codingStats);
      const projectCodingTime = this._aggregateProjectCodingTime(codingStats);
      const contextSwitching = this._calculateContextSwitching(codingStats);
      const sparklines = await this._get6MonthSparklines(txq, userId, yearMonth);
      const sameMonthLastYear = await this._getSameMonthLastYearCoding(txq, userId, yearMonth);

      return {
        ...base,
        categoryBreakdown,
        projectCodingTime,
        deepWorkSessions,
        deepWorkStats,
        contextSwitching,
        sparklines: {
          codingTime: sparklines.codingTime,
        },
        sameMonthLastYear,
      };
    });
  }

  async aggregateEnrichedMonthlyLocation(
    userId: string,
    yearMonth: string
  ): Promise<EnrichedLocationSectionData> {
    return this.db.transaction(async (tx) => {
      const txq = tx as unknown as QueryExecutor;
      const base = await this._aggregateMonthlyLocation(txq, userId, yearMonth);

      const startDate = this._monthStart(yearMonth);
      const endDate = this._monthEnd(yearMonth);
      const startTs = new Date(startDate);
      const endTs = new Date(endDate);

      const monthCommits = await txq
        .select()
        .from(commits)
        .where(
          and(
            eq(commits.userId, userId),
            gte(commits.committedAt, startTs),
            lt(commits.committedAt, endTs)
          )
        );

      const topPlacesEnriched = await this._calculatePlaceProductivity(
        txq,
        userId,
        startTs,
        endTs,
        monthCommits,
        base.topPlaces
      );
      const sparklines = await this._get6MonthSparklines(txq, userId, yearMonth);
      const sameMonthLastYear = await this._getSameMonthLastYearDistance(txq, userId, yearMonth);

      return {
        ...base,
        topPlacesEnriched,
        sparklines: {
          distance: sparklines.distance,
        },
        sameMonthLastYear,
      };
    });
  }

  async aggregateCrossAnalysis(userId: string, yearMonth: string): Promise<CrossAnalysisData> {
    return this.db.transaction(async (tx) => {
      const txq = tx as unknown as QueryExecutor;
      const startDate = this._monthStart(yearMonth);
      const endDate = this._monthEnd(yearMonth);
      const startTs = new Date(startDate);
      const endTs = new Date(endDate);

      const monthCommits = await txq
        .select()
        .from(commits)
        .where(
          and(
            eq(commits.userId, userId),
            gte(commits.committedAt, startTs),
            lt(commits.committedAt, endTs)
          )
        );

      const topPlaces = await this._getTopPlaces(txq, userId, startTs, endTs);
      const placeProductivity = await this._calculatePlaceProductivity(
        txq,
        userId,
        startTs,
        endTs,
        monthCommits,
        topPlaces
      );

      const routinePatterns = await this._detectRoutinePatterns(txq, userId, startDate, endDate);

      return {
        placeProductivity,
        routinePatterns,
      };
    });
  }

  // ==================== Full Aggregation (backward compat) ====================

  async aggregateMonthlyData(userId: string, yearMonth: string): Promise<MonthlyReportData> {
    return this.db.transaction(async (tx) => {
      const txq = tx as unknown as QueryExecutor;
      const [commitsData, codingData, locationData] = await Promise.all([
        this._aggregateMonthlyCommits(txq, userId, yearMonth),
        this._aggregateMonthlyCoding(txq, userId, yearMonth),
        this._aggregateMonthlyLocation(txq, userId, yearMonth),
      ]);

      return {
        ...commitsData,
        ...codingData,
        ...locationData,
        prevMonth: this._combinePrevMonth(commitsData, codingData, locationData),
      };
    });
  }

  async aggregateYearlyData(userId: string, year: string): Promise<YearlyReportData> {
    return this.db.transaction(async (tx) => {
      const txq = tx as unknown as QueryExecutor;
      const [commitsData, codingData, locationData] = await Promise.all([
        this._aggregateYearlyCommits(txq, userId, year),
        this._aggregateYearlyCoding(txq, userId, year),
        this._aggregateYearlyLocation(txq, userId, year),
      ]);

      // Monthly trend — built from daily data across all 3 sections
      const monthlyTrend: YearlyReportData["monthlyTrend"] = [];
      for (let m = 1; m <= 12; m++) {
        const monthStr = `${year}-${String(m).padStart(2, "0")}`;
        const monthStart = `${monthStr}-01`;
        const monthEnd =
          m === 12 ? `${Number(year) + 1}-01-01` : `${year}-${String(m + 1).padStart(2, "0")}-01`;

        const mCommits = commitsData.dailyCommits.filter(
          (d) => d.date >= monthStart && d.date < monthEnd
        );
        const mCoding = codingData.dailyCodingSeconds.filter(
          (d) => d.date >= monthStart && d.date < monthEnd
        );
        const mDist = locationData.dailyDistances.filter(
          (d) => d.date >= monthStart && d.date < monthEnd
        );

        monthlyTrend.push({
          month: monthStr,
          commits: mCommits.reduce((s, d) => s + d.count, 0),
          codingSeconds: mCoding.reduce((s, d) => s + d.seconds, 0),
          distanceMeters: mDist.reduce((s, d) => s + d.meters, 0),
          activeDays: mCommits.length,
        });
      }

      const prevYear = this._combinePrevMonth(commitsData, codingData, locationData);

      return {
        ...commitsData,
        ...codingData,
        ...locationData,
        monthlyTrend,
        projectTimeline: commitsData.projectTimeline,
        newLanguages: codingData.newLanguages,
        quarterlyLanguages: codingData.quarterlyLanguages,
        prevYear,
      };
    });
  }

  // ==================== Monthly Section Internals ====================

  private async _aggregateMonthlyCommits(
    tx: QueryExecutor,
    userId: string,
    yearMonth: string
  ): Promise<CommitsSectionData> {
    const startDate = this._monthStart(yearMonth);
    const endDate = this._monthEnd(yearMonth);
    const startTs = new Date(startDate);
    const endTs = new Date(endDate);

    const monthCommits = await tx
      .select()
      .from(commits)
      .where(
        and(
          eq(commits.userId, userId),
          gte(commits.committedAt, startTs),
          lt(commits.committedAt, endTs)
        )
      );

    const totalCommits = monthCommits.length;
    const totalAdditions = monthCommits.reduce((s, c) => s + (c.additions ?? 0), 0);
    const totalDeletions = monthCommits.reduce((s, c) => s + (c.deletions ?? 0), 0);

    const dailyMap = new Map<string, number>();
    const commitsByDayOfWeek = [0, 0, 0, 0, 0, 0, 0];
    const commitsByHour = new Array(24).fill(0) as number[];

    for (const c of monthCommits) {
      const d = c.committedAt;
      const dateStr = d.toISOString().split("T")[0];
      dailyMap.set(dateStr, (dailyMap.get(dateStr) ?? 0) + 1);
      commitsByDayOfWeek[d.getDay()]++;
      commitsByHour[d.getHours()]++;
    }

    const dailyCommits = [...dailyMap.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const activeDays = dailyMap.size;
    const totalDaysInMonth = this._daysInMonth(yearMonth);
    const maxStreak = this._calculateStreak(dailyMap, startDate, endDate);

    const typeMap = new Map<string, number>();
    for (const c of monthCommits) {
      const type = detectCommitType(c.message);
      typeMap.set(type, (typeMap.get(type) ?? 0) + 1);
    }
    const commitTypeBreakdown = [...typeMap.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    const projectMap = new Map<string, { commits: number; additions: number; deletions: number }>();
    for (const c of monthCommits) {
      const name = c.repoFullName.split("/").pop() ?? c.repoFullName;
      const p = projectMap.get(name) ?? { commits: 0, additions: 0, deletions: 0 };
      p.commits++;
      p.additions += c.additions ?? 0;
      p.deletions += c.deletions ?? 0;
      projectMap.set(name, p);
    }
    const projectBreakdown = [...projectMap.entries()]
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.commits - a.commits);

    // Previous month commits data
    const prevYearMonth = this._prevMonth(yearMonth);
    const prevCommits = await this._aggregatePrevCommits(
      tx,
      userId,
      this._monthStart(prevYearMonth),
      this._monthEnd(prevYearMonth)
    );

    return {
      totalCommits,
      totalAdditions,
      totalDeletions,
      activeDays,
      totalDaysInMonth,
      maxStreak,
      commitsByDayOfWeek,
      commitsByHour,
      dailyCommits,
      commitTypeBreakdown,
      projectBreakdown,
      prevCommits,
    };
  }

  private async _aggregateMonthlyCoding(
    tx: QueryExecutor,
    userId: string,
    yearMonth: string
  ): Promise<CodingSectionData> {
    const startDate = this._monthStart(yearMonth);
    const endDate = this._monthEnd(yearMonth);
    const startTs = new Date(startDate);
    const endTs = new Date(endDate);

    const codingStats = await tx
      .select()
      .from(codingDailyStats)
      .where(
        and(
          eq(codingDailyStats.userId, userId),
          gte(codingDailyStats.date, startDate),
          lt(codingDailyStats.date, endDate)
        )
      );

    const totalCodingSeconds = codingStats.reduce((s, c) => s + c.totalSeconds, 0);
    const dailyCodingSeconds = codingStats
      .map((c) => ({ date: c.date, seconds: c.totalSeconds }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const langMap = new Map<string, number>();
    const editorMap = new Map<string, number>();
    for (const stat of codingStats) {
      const langs = safeJsonParse<{ name: string; totalSeconds: number }[]>(
        stat.languages ?? "[]",
        []
      );
      for (const l of langs) {
        langMap.set(l.name, (langMap.get(l.name) ?? 0) + l.totalSeconds);
      }
      const editors = safeJsonParse<{ name: string; totalSeconds: number }[]>(
        stat.editors ?? "[]",
        []
      );
      for (const e of editors) {
        editorMap.set(e.name, (editorMap.get(e.name) ?? 0) + e.totalSeconds);
      }
    }
    const languageBreakdown = [...langMap.entries()]
      .map(([name, seconds]) => ({ name, seconds }))
      .sort((a, b) => b.seconds - a.seconds);
    const editorBreakdown = [...editorMap.entries()]
      .map(([name, seconds]) => ({ name, seconds }))
      .sort((a, b) => b.seconds - a.seconds);

    const sessions = await tx
      .select()
      .from(codingSessions)
      .where(
        and(
          eq(codingSessions.userId, userId),
          gte(codingSessions.startedAt, startTs),
          lt(codingSessions.startedAt, endTs)
        )
      );

    const aiLines = sessions.reduce((s, c) => s + (c.aiAdditions ?? 0) + (c.aiDeletions ?? 0), 0);
    const humanLines = sessions.reduce(
      (s, c) => s + (c.humanAdditions ?? 0) + (c.humanDeletions ?? 0),
      0
    );

    // Previous month coding data
    const prevYearMonth = this._prevMonth(yearMonth);
    const prevCodingSeconds = await this._aggregatePrevCoding(
      tx,
      userId,
      this._monthStart(prevYearMonth),
      this._monthEnd(prevYearMonth)
    );

    return {
      totalCodingSeconds,
      dailyCodingSeconds,
      languageBreakdown,
      editorBreakdown,
      aiCodeStats: { aiLines, humanLines },
      prevCodingSeconds,
    };
  }

  private async _aggregateMonthlyLocation(
    tx: QueryExecutor,
    userId: string,
    yearMonth: string
  ): Promise<LocationSectionData> {
    const startDate = this._monthStart(yearMonth);
    const endDate = this._monthEnd(yearMonth);
    const startTs = new Date(startDate);
    const endTs = new Date(endDate);

    const distances = await tx
      .select()
      .from(dailyDistances)
      .where(
        and(
          eq(dailyDistances.userId, userId),
          gte(dailyDistances.date, startDate),
          lt(dailyDistances.date, endDate)
        )
      );

    const totalDistanceMeters = distances.reduce((s, d) => s + d.distanceMeters, 0);
    const dailyDistancesArr = distances
      .map((d) => ({ date: d.date, meters: d.distanceMeters }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const locations = await tx
      .select({
        lat: locationPoints.lat,
        lon: locationPoints.lon,
        timestamp: locationPoints.timestamp,
      })
      .from(locationPoints)
      .where(
        and(
          eq(locationPoints.userId, userId),
          gte(locationPoints.timestamp, startTs),
          lt(locationPoints.timestamp, endTs)
        )
      );

    const heatmapMap = new Map<string, { lat: number; lon: number; weight: number }>();
    for (const loc of locations) {
      const key = `${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`;
      const existing = heatmapMap.get(key);
      if (existing) {
        existing.weight += 1;
      } else {
        heatmapMap.set(key, { lat: loc.lat, lon: loc.lon, weight: 1 });
      }
    }
    const locationHeatmapPoints = [...heatmapMap.values()];

    const topPlaces = await this._getTopPlaces(tx, userId, startTs, endTs);

    const locationsWithDates = locations.map((l) => ({
      lat: l.lat,
      lon: l.lon,
      date: l.timestamp.toISOString().split("T")[0],
    }));
    const enriched = await this._enrichLocationsWithPlaceNames(tx, locationsWithDates);
    const overseasTrips = detectOverseasTrips(enriched);

    // Previous month distance data
    const prevYearMonth = this._prevMonth(yearMonth);
    const prevDistanceMeters = await this._aggregatePrevDistance(
      tx,
      userId,
      this._monthStart(prevYearMonth),
      this._monthEnd(prevYearMonth)
    );

    return {
      totalDistanceMeters,
      dailyDistances: dailyDistancesArr,
      topPlaces,
      overseasTrips,
      locationHeatmapPoints,
      prevDistanceMeters,
    };
  }

  // ==================== Yearly Section Internals ====================

  private async _aggregateYearlyCommits(
    tx: QueryExecutor,
    userId: string,
    year: string
  ): Promise<YearlyCommitsSectionData> {
    const startDate = `${year}-01-01`;
    const endDate = `${Number(year) + 1}-01-01`;
    const startTs = new Date(startDate);
    const endTs = new Date(endDate);

    const allCommits = await tx
      .select()
      .from(commits)
      .where(
        and(
          eq(commits.userId, userId),
          gte(commits.committedAt, startTs),
          lt(commits.committedAt, endTs)
        )
      );

    const totalCommits = allCommits.length;
    const totalAdditions = allCommits.reduce((s, c) => s + (c.additions ?? 0), 0);
    const totalDeletions = allCommits.reduce((s, c) => s + (c.deletions ?? 0), 0);

    const dailyMap = new Map<string, number>();
    const commitsByDayOfWeek = [0, 0, 0, 0, 0, 0, 0];
    const commitsByHour = new Array(24).fill(0) as number[];

    for (const c of allCommits) {
      const d = c.committedAt;
      const dateStr = d.toISOString().split("T")[0];
      dailyMap.set(dateStr, (dailyMap.get(dateStr) ?? 0) + 1);
      commitsByDayOfWeek[d.getDay()]++;
      commitsByHour[d.getHours()]++;
    }

    const dailyCommits = [...dailyMap.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const activeDays = dailyMap.size;
    const isLeapYear =
      Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0);
    const totalDaysInMonth = isLeapYear ? 366 : 365;
    const maxStreak = this._calculateStreak(dailyMap, startDate, endDate);

    const typeMap = new Map<string, number>();
    for (const c of allCommits) {
      const type = detectCommitType(c.message);
      typeMap.set(type, (typeMap.get(type) ?? 0) + 1);
    }
    const commitTypeBreakdown = [...typeMap.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    const projectMap = new Map<
      string,
      {
        commits: number;
        additions: number;
        deletions: number;
        firstCommit: string;
        lastCommit: string;
      }
    >();
    for (const c of allCommits) {
      const name = c.repoFullName.split("/").pop() ?? c.repoFullName;
      const dateStr = c.committedAt.toISOString().split("T")[0];
      const p = projectMap.get(name) ?? {
        commits: 0,
        additions: 0,
        deletions: 0,
        firstCommit: dateStr,
        lastCommit: dateStr,
      };
      p.commits++;
      p.additions += c.additions ?? 0;
      p.deletions += c.deletions ?? 0;
      if (dateStr < p.firstCommit) p.firstCommit = dateStr;
      if (dateStr > p.lastCommit) p.lastCommit = dateStr;
      projectMap.set(name, p);
    }

    const projectBreakdown = [...projectMap.entries()]
      .map(([name, data]) => ({
        name,
        commits: data.commits,
        additions: data.additions,
        deletions: data.deletions,
      }))
      .sort((a, b) => b.commits - a.commits);

    const projectTimeline = [...projectMap.entries()]
      .map(([name, data]) => ({
        name,
        firstCommit: data.firstCommit,
        lastCommit: data.lastCommit,
        totalCommits: data.commits,
      }))
      .sort((a, b) => a.firstCommit.localeCompare(b.firstCommit));

    // Previous year commits data
    const prevYear = String(Number(year) - 1);
    const prevCommits = await this._aggregatePrevCommits(
      tx,
      userId,
      `${prevYear}-01-01`,
      startDate
    );

    return {
      totalCommits,
      totalAdditions,
      totalDeletions,
      activeDays,
      totalDaysInMonth,
      maxStreak,
      commitsByDayOfWeek,
      commitsByHour,
      dailyCommits,
      commitTypeBreakdown,
      projectBreakdown,
      projectTimeline,
      prevCommits,
    };
  }

  private async _aggregateYearlyCoding(
    tx: QueryExecutor,
    userId: string,
    year: string
  ): Promise<YearlyCodingSectionData> {
    const startDate = `${year}-01-01`;
    const endDate = `${Number(year) + 1}-01-01`;
    const startTs = new Date(startDate);
    const endTs = new Date(endDate);

    const codingStats = await tx
      .select()
      .from(codingDailyStats)
      .where(
        and(
          eq(codingDailyStats.userId, userId),
          gte(codingDailyStats.date, startDate),
          lt(codingDailyStats.date, endDate)
        )
      );

    const totalCodingSeconds = codingStats.reduce((s, c) => s + c.totalSeconds, 0);
    const dailyCodingSeconds = codingStats
      .map((c) => ({ date: c.date, seconds: c.totalSeconds }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const langMap = new Map<string, number>();
    const editorMap = new Map<string, number>();
    const quarterMap = new Map<string, Map<string, number>>();

    for (const stat of codingStats) {
      const quarter = `Q${Math.ceil(Number(stat.date.slice(5, 7)) / 3)}`;
      const langs = safeJsonParse<{ name: string; totalSeconds: number }[]>(
        stat.languages ?? "[]",
        []
      );
      for (const l of langs) {
        langMap.set(l.name, (langMap.get(l.name) ?? 0) + l.totalSeconds);
        const qLangs = quarterMap.get(quarter) ?? new Map<string, number>();
        qLangs.set(l.name, (qLangs.get(l.name) ?? 0) + l.totalSeconds);
        quarterMap.set(quarter, qLangs);
      }
      const editors = safeJsonParse<{ name: string; totalSeconds: number }[]>(
        stat.editors ?? "[]",
        []
      );
      for (const e of editors) {
        editorMap.set(e.name, (editorMap.get(e.name) ?? 0) + e.totalSeconds);
      }
    }

    const languageBreakdown = [...langMap.entries()]
      .map(([name, seconds]) => ({ name, seconds }))
      .sort((a, b) => b.seconds - a.seconds);
    const editorBreakdown = [...editorMap.entries()]
      .map(([name, seconds]) => ({ name, seconds }))
      .sort((a, b) => b.seconds - a.seconds);

    const quarterlyLanguages = [...quarterMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([quarter, langs]) => ({
        quarter,
        languages: [...langs.entries()]
          .map(([name, seconds]) => ({ name, seconds }))
          .sort((a, b) => b.seconds - a.seconds),
      }));

    // New languages (compare with prev year)
    const prevYear = String(Number(year) - 1);
    const prevCodingStats = await tx
      .select()
      .from(codingDailyStats)
      .where(
        and(
          eq(codingDailyStats.userId, userId),
          gte(codingDailyStats.date, `${prevYear}-01-01`),
          lt(codingDailyStats.date, startDate)
        )
      );

    const prevLangs = new Set<string>();
    for (const stat of prevCodingStats) {
      const langs = safeJsonParse<{ name: string; totalSeconds: number }[]>(
        stat.languages ?? "[]",
        []
      );
      for (const l of langs) prevLangs.add(l.name);
    }
    const newLanguages = languageBreakdown.filter((l) => !prevLangs.has(l.name)).map((l) => l.name);

    // AI code stats
    const allSessions = await tx
      .select()
      .from(codingSessions)
      .where(
        and(
          eq(codingSessions.userId, userId),
          gte(codingSessions.startedAt, startTs),
          lt(codingSessions.startedAt, endTs)
        )
      );
    const aiLines = allSessions.reduce(
      (s, c) => s + (c.aiAdditions ?? 0) + (c.aiDeletions ?? 0),
      0
    );
    const humanLines = allSessions.reduce(
      (s, c) => s + (c.humanAdditions ?? 0) + (c.humanDeletions ?? 0),
      0
    );

    // Previous year coding data
    const prevCodingSeconds = await this._aggregatePrevCoding(
      tx,
      userId,
      `${prevYear}-01-01`,
      startDate
    );

    return {
      totalCodingSeconds,
      dailyCodingSeconds,
      languageBreakdown,
      editorBreakdown,
      aiCodeStats: { aiLines, humanLines },
      quarterlyLanguages,
      newLanguages,
      prevCodingSeconds,
    };
  }

  private async _aggregateYearlyLocation(
    tx: QueryExecutor,
    userId: string,
    year: string
  ): Promise<LocationSectionData> {
    const startDate = `${year}-01-01`;
    const endDate = `${Number(year) + 1}-01-01`;
    const startTs = new Date(startDate);
    const endTs = new Date(endDate);

    const allDistances = await tx
      .select()
      .from(dailyDistances)
      .where(
        and(
          eq(dailyDistances.userId, userId),
          gte(dailyDistances.date, startDate),
          lt(dailyDistances.date, endDate)
        )
      );

    const totalDistanceMeters = allDistances.reduce((s, d) => s + d.distanceMeters, 0);
    const dailyDistancesArr = allDistances
      .map((d) => ({ date: d.date, meters: d.distanceMeters }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const locations = await tx
      .select({
        lat: locationPoints.lat,
        lon: locationPoints.lon,
        timestamp: locationPoints.timestamp,
      })
      .from(locationPoints)
      .where(
        and(
          eq(locationPoints.userId, userId),
          gte(locationPoints.timestamp, startTs),
          lt(locationPoints.timestamp, endTs)
        )
      );

    const heatmapMap = new Map<string, { lat: number; lon: number; weight: number }>();
    for (const loc of locations) {
      const key = `${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`;
      const existing = heatmapMap.get(key);
      if (existing) existing.weight += 1;
      else heatmapMap.set(key, { lat: loc.lat, lon: loc.lon, weight: 1 });
    }
    const locationHeatmapPoints = [...heatmapMap.values()];

    const topPlaces = await this._getTopPlaces(tx, userId, startTs, endTs);

    const locationsWithDates = locations.map((l) => ({
      lat: l.lat,
      lon: l.lon,
      date: l.timestamp.toISOString().split("T")[0],
    }));
    const enriched = await this._enrichLocationsWithPlaceNames(tx, locationsWithDates);
    const overseasTrips = detectOverseasTrips(enriched);

    // Previous year distance data
    const prevYear = String(Number(year) - 1);
    const prevDistanceMeters = await this._aggregatePrevDistance(
      tx,
      userId,
      `${prevYear}-01-01`,
      startDate
    );

    return {
      totalDistanceMeters,
      dailyDistances: dailyDistancesArr,
      topPlaces,
      overseasTrips,
      locationHeatmapPoints,
      prevDistanceMeters,
    };
  }

  // ==================== AI Narrative ====================

  async generateMonthlyNarrative(
    userId: string,
    yearMonth: string,
    data: MonthlyReportData,
    enriched?: {
      workLifeBalance?: WorkLifeBalanceMetrics;
      deepWorkStats?: EnrichedCodingSectionData["deepWorkStats"];
      categoryBreakdown?: { name: string; seconds: number }[];
      contextSwitching?: ContextSwitchingMetrics;
      placeProductivity?: PlaceProductivity[];
      routinePatterns?: RoutinePattern[];
    }
  ): Promise<string> {
    const summaries = await this.getCommitSummariesForPeriod(
      userId,
      this._monthStart(yearMonth),
      this._monthEnd(yearMonth)
    );
    return this._generateNarrative(
      buildMonthlyNarrativePrompt(yearMonth, data, summaries, enriched)
    );
  }

  async generateYearlyNarrative(
    userId: string,
    year: string,
    data: YearlyReportData,
    enriched?: {
      workLifeBalance?: WorkLifeBalanceMetrics;
      deepWorkStats?: EnrichedCodingSectionData["deepWorkStats"];
      categoryBreakdown?: { name: string; seconds: number }[];
      contextSwitching?: ContextSwitchingMetrics;
      placeProductivity?: PlaceProductivity[];
      routinePatterns?: RoutinePattern[];
    }
  ): Promise<string> {
    const summaries = await this.getCommitSummariesForPeriod(
      userId,
      `${year}-01-01`,
      `${Number(year) + 1}-01-01`
    );
    return this._generateNarrative(buildYearlyNarrativePrompt(year, data, summaries, enriched));
  }

  // ==================== Helpers ====================

  async getCommitSummariesForPeriod(
    userId: string,
    startDate: string,
    endDate: string
  ): Promise<string[]> {
    const result = await this.db
      .select({ summary: commitSummaries.summary })
      .from(commitSummaries)
      .innerJoin(commits, eq(commitSummaries.commitId, commits.id))
      .where(
        and(
          eq(commits.userId, userId),
          gte(commits.committedAt, new Date(startDate)),
          lt(commits.committedAt, new Date(endDate)),
          eq(commitSummaries.status, "completed")
        )
      )
      .orderBy(desc(commits.committedAt))
      .limit(20);

    return result.filter((r) => r.summary).map((r) => r.summary!);
  }

  private _combinePrevMonth(
    commitsData: CommitsSectionData,
    codingData: CodingSectionData,
    locationData: LocationSectionData
  ):
    | {
        totalCommits: number;
        totalCodingSeconds: number;
        totalDistanceMeters: number;
        activeDays: number;
      }
    | undefined {
    if (
      !commitsData.prevCommits &&
      commitsData.prevCommits === undefined &&
      codingData.prevCodingSeconds === undefined &&
      locationData.prevDistanceMeters === undefined
    ) {
      return undefined;
    }
    return {
      totalCommits: commitsData.prevCommits?.totalCommits ?? 0,
      totalCodingSeconds: codingData.prevCodingSeconds ?? 0,
      totalDistanceMeters: locationData.prevDistanceMeters ?? 0,
      activeDays: commitsData.prevCommits?.activeDays ?? 0,
    };
  }

  private async _aggregatePrevCommits(
    tx: QueryExecutor,
    userId: string,
    startDate: string,
    endDate: string
  ): Promise<{ totalCommits: number; activeDays: number } | undefined> {
    const startTs = new Date(startDate);
    const endTs = new Date(endDate);

    const [commitCount] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(commits)
      .where(
        and(
          eq(commits.userId, userId),
          gte(commits.committedAt, startTs),
          lt(commits.committedAt, endTs)
        )
      );

    if (commitCount.count === 0) return undefined;

    const [activeDaysCount] = await tx
      .select({ count: sql<number>`count(distinct date(${commits.committedAt}))::int` })
      .from(commits)
      .where(
        and(
          eq(commits.userId, userId),
          gte(commits.committedAt, startTs),
          lt(commits.committedAt, endTs)
        )
      );

    return {
      totalCommits: commitCount.count,
      activeDays: activeDaysCount.count,
    };
  }

  private async _aggregatePrevCoding(
    tx: QueryExecutor,
    userId: string,
    startDate: string,
    endDate: string
  ): Promise<number | undefined> {
    const [codingSum] = await tx
      .select({
        total: sql<number>`coalesce(sum(${codingDailyStats.totalSeconds}), 0)::int`,
      })
      .from(codingDailyStats)
      .where(
        and(
          eq(codingDailyStats.userId, userId),
          gte(codingDailyStats.date, startDate),
          lt(codingDailyStats.date, endDate)
        )
      );

    return codingSum.total > 0 ? codingSum.total : undefined;
  }

  private async _aggregatePrevDistance(
    tx: QueryExecutor,
    userId: string,
    startDate: string,
    endDate: string
  ): Promise<number | undefined> {
    const [distanceSum] = await tx
      .select({
        total: sql<number>`coalesce(sum(${dailyDistances.distanceMeters}), 0)::float`,
      })
      .from(dailyDistances)
      .where(
        and(
          eq(dailyDistances.userId, userId),
          gte(dailyDistances.date, startDate),
          lt(dailyDistances.date, endDate)
        )
      );

    return distanceSum.total > 0 ? distanceSum.total : undefined;
  }

  private async _getTopPlaces(
    tx: QueryExecutor,
    userId: string,
    startTs: Date,
    endTs: Date
  ): Promise<MonthlyReportData["topPlaces"]> {
    const points = await tx
      .select({
        lat: locationPoints.lat,
        lon: locationPoints.lon,
        timestamp: locationPoints.timestamp,
      })
      .from(locationPoints)
      .where(
        and(
          eq(locationPoints.userId, userId),
          gte(locationPoints.timestamp, startTs),
          lt(locationPoints.timestamp, endTs)
        )
      )
      .orderBy(locationPoints.timestamp);

    if (points.length === 0) return [];

    // 유저 저장 장소 조회 (우선 매칭용)
    const userSavedPlaces = await tx
      .select()
      .from(savedPlaces)
      .where(eq(savedPlaces.userId, userId));

    const placeMap = new Map<
      string,
      { lat: number; lon: number; count: number; totalMinutes: number }
    >();

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const key = `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
      const existing = placeMap.get(key);

      let minutes = 5;
      if (i + 1 < points.length) {
        const diff = (points[i + 1].timestamp.getTime() - p.timestamp.getTime()) / 60000;
        minutes = Math.min(diff, 60);
      }

      if (existing) {
        existing.count++;
        existing.totalMinutes += minutes;
      } else {
        placeMap.set(key, { lat: p.lat, lon: p.lon, count: 1, totalMinutes: minutes });
      }
    }

    const places = [...placeMap.values()]
      .sort((a, b) => b.totalMinutes - a.totalMinutes)
      .slice(0, 10);

    const result: MonthlyReportData["topPlaces"] = [];

    for (const place of places) {
      // 저장 장소 우선 매칭 (Haversine, radiusM 기준)
      const matchedSaved = userSavedPlaces.find(
        (sp) => distanceM(place.lat, place.lon, sp.lat, sp.lon) <= sp.radiusM
      );

      if (matchedSaved) {
        result.push({
          placeName: matchedSaved.name,
          address: matchedSaved.address ?? "",
          category: matchedSaved.category ?? null,
          visitCount: place.count,
          totalMinutes: place.totalMinutes,
          lat: place.lat,
          lon: place.lon,
          isOverseas: isOverseas(place.lat, place.lon),
        });
        continue;
      }

      // 저장 장소 미매칭 → placeCache(지오코딩) 폴백
      const cached = await tx
        .select()
        .from(placeCache)
        .where(
          and(
            sql`ABS(${placeCache.latKey} - ${place.lat}) < 0.005`,
            sql`ABS(${placeCache.lonKey} - ${place.lon}) < 0.005`
          )
        )
        .limit(1);

      const placeName = cached[0]?.placeName ?? `${place.lat.toFixed(3)}, ${place.lon.toFixed(3)}`;
      const address = cached[0]?.address ?? "";
      const category = cached[0]?.category ?? null;

      result.push({
        placeName,
        address,
        category,
        visitCount: place.count,
        totalMinutes: place.totalMinutes,
        lat: place.lat,
        lon: place.lon,
        isOverseas: isOverseas(place.lat, place.lon),
      });
    }

    return result;
  }

  private async _enrichLocationsWithPlaceNames(
    tx: QueryExecutor,
    locations: { lat: number; lon: number; date: string }[]
  ): Promise<{ lat: number; lon: number; date: string; placeName?: string | null }[]> {
    if (locations.length === 0) return [];

    const allPlaces = await tx.select().from(placeCache);

    return locations.map((loc) => {
      const closest = allPlaces.find(
        (p) => Math.abs(p.latKey - loc.lat) < 0.005 && Math.abs(p.lonKey - loc.lon) < 0.005
      );
      return { ...loc, placeName: closest?.placeName ?? null };
    });
  }

  private async _generateNarrative(prompt: string): Promise<string> {
    if (!this.anthropicApiKey) return "";

    const ai = createClaudeAdapter(this.anthropicApiKey);
    const result = await ai.generateText({
      prompt,
      maxTokens: 2000,
      temperature: 0.7,
    });

    return result.content;
  }

  // ==================== Deep Reports Private Methods ====================

  private async _detectDeepWorkSessions(
    tx: QueryExecutor,
    userId: string,
    startTs: Date,
    endTs: Date
  ): Promise<{
    sessions: DeepWorkSession[];
    stats: { totalSessions: number; avgDurationSeconds: number; totalDeepWorkSeconds: number };
  }> {
    const allSessions = await tx
      .select()
      .from(codingSessions)
      .where(
        and(
          eq(codingSessions.userId, userId),
          gte(codingSessions.startedAt, startTs),
          lt(codingSessions.startedAt, endTs),
          gte(codingSessions.durationSeconds, 7200)
        )
      )
      .orderBy(desc(codingSessions.startedAt));

    const sessions: DeepWorkSession[] = allSessions.map((s) => ({
      date: s.startedAt.toISOString().split("T")[0],
      project: s.project,
      durationSeconds: s.durationSeconds,
      startedAt: s.startedAt.toISOString(),
    }));

    const totalDeepWorkSeconds = sessions.reduce((s, d) => s + d.durationSeconds, 0);

    return {
      sessions,
      stats: {
        totalSessions: sessions.length,
        avgDurationSeconds:
          sessions.length > 0 ? Math.round(totalDeepWorkSeconds / sessions.length) : 0,
        totalDeepWorkSeconds,
      },
    };
  }

  private _calculateWorkLifeBalance(monthCommits: { committedAt: Date }[]): WorkLifeBalanceMetrics {
    if (monthCommits.length === 0) {
      return { nightCommitRatio: 0, weekendCommitRatio: 0, balanceScore: 100 };
    }

    let nightCommits = 0;
    let weekendCommits = 0;

    for (const c of monthCommits) {
      const hour = c.committedAt.getHours();
      const day = c.committedAt.getDay();
      if (hour >= 22 || hour < 6) nightCommits++;
      if (day === 0 || day === 6) weekendCommits++;
    }

    const nightCommitRatio = Math.round((nightCommits / monthCommits.length) * 100) / 100;
    const weekendCommitRatio = Math.round((weekendCommits / monthCommits.length) * 100) / 100;

    // 밸런스 점수: 야간/주말 비율이 낮을수록 높음 (100점 만점)
    // 야간 30% 이상 → 감점, 주말 40% 이상 → 감점
    const nightPenalty = Math.min(nightCommitRatio / 0.3, 1) * 40;
    const weekendPenalty = Math.min(weekendCommitRatio / 0.4, 1) * 30;
    const balanceScore = Math.max(0, Math.round(100 - nightPenalty - weekendPenalty));

    return { nightCommitRatio, weekendCommitRatio, balanceScore };
  }

  private _calculateContextSwitching(
    codingStats: { date: string; projects: string | null; languages: string | null }[]
  ): ContextSwitchingMetrics {
    if (codingStats.length === 0) {
      return { avgDailyProjects: 0, avgDailyLanguages: 0, focusScore: 100 };
    }

    let totalProjects = 0;
    let totalLanguages = 0;

    for (const stat of codingStats) {
      const projects = safeJsonParse<{ name: string; totalSeconds: number }[]>(
        stat.projects ?? "[]",
        []
      );
      const languages = safeJsonParse<{ name: string; totalSeconds: number }[]>(
        stat.languages ?? "[]",
        []
      );
      totalProjects += projects.length;
      totalLanguages += languages.length;
    }

    const avgDailyProjects = Math.round((totalProjects / codingStats.length) * 10) / 10;
    const avgDailyLanguages = Math.round((totalLanguages / codingStats.length) * 10) / 10;

    // 집중도 점수: 하루 평균 프로젝트 수가 적을수록 높음
    // 1개 = 100점, 5개 이상 = 0점
    const focusScore = Math.max(0, Math.round(100 - (avgDailyProjects - 1) * 25));

    return { avgDailyProjects, avgDailyLanguages, focusScore };
  }

  private async _detectRoutinePatterns(
    tx: QueryExecutor,
    userId: string,
    startDate: string,
    endDate: string
  ): Promise<RoutinePattern[]> {
    const stats = await tx
      .select()
      .from(codingDailyStats)
      .where(
        and(
          eq(codingDailyStats.userId, userId),
          gte(codingDailyStats.date, startDate),
          lt(codingDailyStats.date, endDate)
        )
      );

    // 요일별로 카테고리 집계
    const dayMap = new Map<number, Map<string, number>>();

    for (const stat of stats) {
      const dayOfWeek = new Date(stat.date).getDay();
      const categories = safeJsonParse<{ name: string; totalSeconds: number }[]>(
        stat.categories ?? "[]",
        []
      );

      if (!dayMap.has(dayOfWeek)) dayMap.set(dayOfWeek, new Map());
      const catMap = dayMap.get(dayOfWeek)!;

      for (const cat of categories) {
        catMap.set(cat.name, (catMap.get(cat.name) ?? 0) + cat.totalSeconds);
      }
    }

    const patterns: RoutinePattern[] = [];
    for (const [dayOfWeek, catMap] of dayMap) {
      if (catMap.size === 0) continue;
      let dominant = "";
      let maxSeconds = 0;
      let totalSeconds = 0;
      for (const [name, seconds] of catMap) {
        totalSeconds += seconds;
        if (seconds > maxSeconds) {
          maxSeconds = seconds;
          dominant = name;
        }
      }
      patterns.push({ dayOfWeek, dominantCategory: dominant, totalSeconds });
    }

    return patterns.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  }

  private async _calculatePlaceProductivity(
    tx: QueryExecutor,
    userId: string,
    startTs: Date,
    endTs: Date,
    monthCommits: { committedAt: Date; lat?: number | null; lon?: number | null }[],
    topPlaces: { placeName: string; address: string; lat: number; lon: number }[]
  ): Promise<PlaceProductivity[]> {
    if (topPlaces.length === 0) return [];

    // 각 장소별로 근처에서 발생한 커밋 수 + 코딩 세션 시간을 계산
    const result: PlaceProductivity[] = [];

    // 커밋의 시간대에 가장 가까운 위치 포인트를 찾기
    const locPoints = await tx
      .select({
        lat: locationPoints.lat,
        lon: locationPoints.lon,
        timestamp: locationPoints.timestamp,
      })
      .from(locationPoints)
      .where(
        and(
          eq(locationPoints.userId, userId),
          gte(locationPoints.timestamp, startTs),
          lt(locationPoints.timestamp, endTs)
        )
      )
      .orderBy(locationPoints.timestamp);

    for (const place of topPlaces.slice(0, 5)) {
      const threshold = 0.005; // ~500m

      // 이 장소 근처에 있었던 시간대 찾기
      const nearbyTimestamps: Date[] = [];
      for (const lp of locPoints) {
        if (Math.abs(lp.lat - place.lat) < threshold && Math.abs(lp.lon - place.lon) < threshold) {
          nearbyTimestamps.push(lp.timestamp);
        }
      }

      if (nearbyTimestamps.length === 0) {
        result.push({
          placeName: place.placeName,
          address: place.address,
          lat: place.lat,
          lon: place.lon,
          commitCount: 0,
          codingSeconds: 0,
          productivityScore: 0,
        });
        continue;
      }

      // 장소 근처에 있었던 시간 범위에서 커밋 수 계산
      let commitCount = 0;
      for (const c of monthCommits) {
        // 커밋 시각 ± 1시간 내에 이 장소 근처에 위치 기록이 있으면 매칭
        const commitTime = c.committedAt.getTime();
        const isNearby = nearbyTimestamps.some(
          (ts) => Math.abs(ts.getTime() - commitTime) < 3600000
        );
        if (isNearby) commitCount++;
      }

      // 장소 근처 코딩 세션 시간 계산
      const nearbySessions = await tx
        .select()
        .from(codingSessions)
        .where(
          and(
            eq(codingSessions.userId, userId),
            gte(codingSessions.startedAt, startTs),
            lt(codingSessions.startedAt, endTs)
          )
        );

      let codingSeconds = 0;
      for (const session of nearbySessions) {
        const sessionTime = session.startedAt.getTime();
        const isNearby = nearbyTimestamps.some(
          (ts) => Math.abs(ts.getTime() - sessionTime) < 3600000
        );
        if (isNearby) codingSeconds += session.durationSeconds;
      }

      // 생산성 점수: 커밋 수 * 10 + 코딩 시간(시간) * 5, 100점 만점으로 정규화
      const rawScore = commitCount * 10 + (codingSeconds / 3600) * 5;
      const productivityScore = Math.min(100, Math.round(rawScore));

      result.push({
        placeName: place.placeName,
        address: place.address,
        lat: place.lat,
        lon: place.lon,
        commitCount,
        codingSeconds,
        productivityScore,
      });
    }

    return result.sort((a, b) => b.productivityScore - a.productivityScore);
  }

  private _aggregateCategories(
    codingStats: { categories: string | null }[]
  ): { name: string; seconds: number }[] {
    const catMap = new Map<string, number>();
    for (const stat of codingStats) {
      const categories = safeJsonParse<{ name: string; totalSeconds: number }[]>(
        stat.categories ?? "[]",
        []
      );
      for (const cat of categories) {
        catMap.set(cat.name, (catMap.get(cat.name) ?? 0) + cat.totalSeconds);
      }
    }
    return [...catMap.entries()]
      .map(([name, seconds]) => ({ name, seconds }))
      .sort((a, b) => b.seconds - a.seconds);
  }

  private _aggregateProjectCodingTime(
    codingStats: { projects: string | null }[]
  ): { name: string; seconds: number }[] {
    const projMap = new Map<string, number>();
    for (const stat of codingStats) {
      const projects = safeJsonParse<{ name: string; totalSeconds: number }[]>(
        stat.projects ?? "[]",
        []
      );
      for (const proj of projects) {
        projMap.set(proj.name, (projMap.get(proj.name) ?? 0) + proj.totalSeconds);
      }
    }
    return [...projMap.entries()]
      .map(([name, seconds]) => ({ name, seconds }))
      .sort((a, b) => b.seconds - a.seconds);
  }

  private async _get6MonthSparklines(
    tx: QueryExecutor,
    userId: string,
    currentYearMonth: string
  ): Promise<{
    commits: SparklineData[];
    activeDays: SparklineData[];
    codingTime: SparklineData[];
    distance: SparklineData[];
  }> {
    const sparkCommits: SparklineData[] = [];
    const sparkActiveDays: SparklineData[] = [];
    const sparkCodingTime: SparklineData[] = [];
    const sparkDistance: SparklineData[] = [];

    for (let i = 5; i >= 0; i--) {
      const ym = this._offsetMonth(currentYearMonth, -i);
      const start = this._monthStart(ym);
      const end = this._monthEnd(ym);

      const prevCommits = await this._aggregatePrevCommits(tx, userId, start, end);
      sparkCommits.push({ date: ym, value: prevCommits?.totalCommits ?? 0 });
      sparkActiveDays.push({ date: ym, value: prevCommits?.activeDays ?? 0 });

      const prevCoding = await this._aggregatePrevCoding(tx, userId, start, end);
      sparkCodingTime.push({ date: ym, value: prevCoding ?? 0 });

      const prevDistance = await this._aggregatePrevDistance(tx, userId, start, end);
      sparkDistance.push({ date: ym, value: prevDistance ?? 0 });
    }

    return {
      commits: sparkCommits,
      activeDays: sparkActiveDays,
      codingTime: sparkCodingTime,
      distance: sparkDistance,
    };
  }

  private async _getSameMonthLastYearCommits(
    tx: QueryExecutor,
    userId: string,
    yearMonth: string
  ): Promise<{ totalCommits: number; activeDays: number } | undefined> {
    const [y, m] = yearMonth.split("-").map(Number);
    const lastYearMonth = `${y - 1}-${String(m).padStart(2, "0")}`;
    return this._aggregatePrevCommits(
      tx,
      userId,
      this._monthStart(lastYearMonth),
      this._monthEnd(lastYearMonth)
    );
  }

  private async _getSameMonthLastYearCoding(
    tx: QueryExecutor,
    userId: string,
    yearMonth: string
  ): Promise<{ totalCodingSeconds: number } | undefined> {
    const [y, m] = yearMonth.split("-").map(Number);
    const lastYearMonth = `${y - 1}-${String(m).padStart(2, "0")}`;
    const total = await this._aggregatePrevCoding(
      tx,
      userId,
      this._monthStart(lastYearMonth),
      this._monthEnd(lastYearMonth)
    );
    return total !== undefined ? { totalCodingSeconds: total } : undefined;
  }

  private async _getSameMonthLastYearDistance(
    tx: QueryExecutor,
    userId: string,
    yearMonth: string
  ): Promise<{ totalDistanceMeters: number } | undefined> {
    const [y, m] = yearMonth.split("-").map(Number);
    const lastYearMonth = `${y - 1}-${String(m).padStart(2, "0")}`;
    const total = await this._aggregatePrevDistance(
      tx,
      userId,
      this._monthStart(lastYearMonth),
      this._monthEnd(lastYearMonth)
    );
    return total !== undefined ? { totalDistanceMeters: total } : undefined;
  }

  // ==================== Date Utilities ====================

  private _monthStart(yearMonth: string): string {
    return `${yearMonth}-01`;
  }

  private _monthEnd(yearMonth: string): string {
    const [y, m] = yearMonth.split("-").map(Number);
    if (m === 12) return `${y + 1}-01-01`;
    return `${y}-${String(m + 1).padStart(2, "0")}-01`;
  }

  private _daysInMonth(yearMonth: string): number {
    const [y, m] = yearMonth.split("-").map(Number);
    return new Date(y, m, 0).getDate();
  }

  private _prevMonth(yearMonth: string): string {
    const [y, m] = yearMonth.split("-").map(Number);
    if (m === 1) return `${y - 1}-12`;
    return `${y}-${String(m - 1).padStart(2, "0")}`;
  }

  private _offsetMonth(yearMonth: string, offset: number): string {
    const [y, m] = yearMonth.split("-").map(Number);
    const d = new Date(y, m - 1 + offset, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  private _calculateStreak(
    dailyMap: Map<string, number>,
    startDate: string,
    endDate: string
  ): number {
    let maxStreak = 0;
    let currentStreak = 0;
    const start = new Date(startDate);
    const end = new Date(endDate);

    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      if (dailyMap.has(dateStr)) {
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }

    return maxStreak;
  }
}

export function createReportService(db: Database, anthropicApiKey?: string): ReportService {
  return new ReportService(db, anthropicApiKey);
}
