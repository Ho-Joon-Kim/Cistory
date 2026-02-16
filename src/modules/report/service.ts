/**
 * Report Service
 *
 * 월간/연간 보고서 데이터를 실시간(on-the-fly)으로 집계 + AI 내러티브 생성
 * 모든 집계 쿼리는 단일 트랜잭션(=단일 커넥션)으로 실행하여 connection pool 소진 방지
 * 섹션별(commits/coding/location) 독립 집계 메서드를 제공하여 병렬 로딩 지원
 */

import { eq, and, gte, lt, sql, desc } from "drizzle-orm";
import type { Database } from "@/db";
import {
  commits,
  commitSummaries,
  codingSessions,
  codingDailyStats,
  dailyDistances,
  locationPoints,
  placeCache,
} from "@/db/schema";
import { createClaudeAdapter } from "@/lib/adapters/ai/claude";
import { safeJsonParse } from "@/lib/utils";
import { detectCommitType } from "@/modules/summary/prompts";
import { detectOverseasTrips, isOverseas } from "./travel";
import { buildMonthlyNarrativePrompt, buildYearlyNarrativePrompt } from "./prompts";
import type {
  MonthlyReportData,
  YearlyReportData,
  CommitsSectionData,
  CodingSectionData,
  LocationSectionData,
  YearlyCommitsSectionData,
  YearlyCodingSectionData,
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

    const projectMap = new Map<
      string,
      { commits: number; additions: number; deletions: number }
    >();
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
    data: MonthlyReportData
  ): Promise<string> {
    const summaries = await this.getCommitSummariesForPeriod(
      userId,
      this._monthStart(yearMonth),
      this._monthEnd(yearMonth)
    );
    return this._generateNarrative(buildMonthlyNarrativePrompt(yearMonth, data, summaries));
  }

  async generateYearlyNarrative(
    userId: string,
    year: string,
    data: YearlyReportData
  ): Promise<string> {
    const summaries = await this.getCommitSummariesForPeriod(
      userId,
      `${year}-01-01`,
      `${Number(year) + 1}-01-01`
    );
    return this._generateNarrative(buildYearlyNarrativePrompt(year, data, summaries));
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
    | { totalCommits: number; totalCodingSeconds: number; totalDistanceMeters: number; activeDays: number }
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

      const placeName =
        cached[0]?.placeName ?? `${place.lat.toFixed(3)}, ${place.lon.toFixed(3)}`;
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
