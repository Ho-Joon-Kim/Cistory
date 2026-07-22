import { sql } from "drizzle-orm";
import { codingDailyStats, codingSessions, commits } from "@/db/schema";
import { localDaySql } from "@/db/sql";
import { toLocalDateString } from "@/lib/utils";
import type { CodingAggregate, NamedSeconds, PeriodAggregateInput } from "../types";
import type { LocationReadExecutor } from "./location";

type QueryResult = { rows?: unknown[] };

function rows(result: unknown): Record<string, unknown>[] {
  const value = result as QueryResult | null;
  return Array.isArray(value?.rows) ? (value.rows as Record<string, unknown>[]) : [];
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNamedSeconds(value: unknown): NamedSeconds[] {
  if (value == null || value === "") return [];
  try {
    const parsed = (typeof value === "string" ? JSON.parse(value) : value) as {
      name?: unknown;
      totalSeconds?: unknown;
    }[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        name: String(item.name ?? "unknown"),
        seconds: numberValue(item.totalSeconds),
      }))
      .filter((item) => item.seconds > 0);
  } catch {
    return [];
  }
}

function addNamed(target: Map<string, number>, values: NamedSeconds[]) {
  for (const value of values) target.set(value.name, (target.get(value.name) ?? 0) + value.seconds);
}

function sortedNamed(source: Map<string, number>): NamedSeconds[] {
  return [...source]
    .map(([name, seconds]) => ({ name, seconds }))
    .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));
}

export async function aggregateCoding(
  executor: LocationReadExecutor,
  input: PeriodAggregateInput & { from: Date; toExclusive: Date }
): Promise<CodingAggregate> {
  const fromDay = toLocalDateString(input.from);
  const toDay = toLocalDateString(input.toExclusive);
  const [commitResult, codingResult, sessionResult] = await Promise.all([
    executor.execute(sql`
      SELECT
        ${localDaySql(commits.committedAt)}::text AS date,
        EXTRACT(DOW FROM ${commits.committedAt})::int AS weekday,
        EXTRACT(HOUR FROM (${commits.committedAt} at time zone 'UTC' at time zone 'Asia/Seoul'))::int AS hour,
        ${commits.repoFullName} AS project,
        CASE
          WHEN LOWER(${commits.message}) ~ '^(feat)(\\(.+\\))?:|^(add|implement|새로운|추가|기능)' THEN 'feat'
          WHEN LOWER(${commits.message}) ~ '^(fix)(\\(.+\\))?:|^(버그|수정|해결|bugfix)' THEN 'fix'
          WHEN LOWER(${commits.message}) ~ '^(refactor)(\\(.+\\))?:|^(리팩토링|리팩터|개선|정리)' THEN 'refactor'
          WHEN LOWER(${commits.message}) ~ '^(style)(\\(.+\\))?:|^(ui|css|디자인|스타일)' THEN 'style'
          WHEN LOWER(${commits.message}) ~ '^(docs?)(\\(.+\\))?:|^(문서|readme)' THEN 'docs'
          WHEN LOWER(${commits.message}) ~ '^(tests?)(\\(.+\\))?:|^(테스트|spec)' THEN 'test'
          WHEN LOWER(${commits.message}) ~ '^(chore)(\\(.+\\))?:|^(build|ci|설정|config)' THEN 'chore'
          WHEN LOWER(${commits.message}) ~ '^(perf)(\\(.+\\))?:|^(성능|최적화|optimize)' THEN 'perf'
          ELSE 'unknown'
        END AS "commitType",
        COUNT(*)::int AS count,
        COALESCE(SUM(${commits.additions}), 0)::int AS additions,
        COALESCE(SUM(${commits.deletions}), 0)::int AS deletions,
        MIN(${commits.committedAt}) AS "firstCommit",
        MAX(${commits.committedAt}) AS "lastCommit"
      FROM ${commits}
      WHERE ${commits.userId} = ${input.userId}
        AND ${commits.committedAt} >= ${input.from}
        AND ${commits.committedAt} < ${input.toExclusive}
      GROUP BY 1, 2, 3, 4, 5
      ORDER BY 1, 2, 3, 4, 5
    `),
    executor.execute(sql`
      SELECT ${codingDailyStats.date} AS date,
        ${codingDailyStats.totalSeconds} AS seconds,
        ${codingDailyStats.languages} AS languages,
        ${codingDailyStats.projects} AS projects
      FROM ${codingDailyStats}
      WHERE ${codingDailyStats.userId} = ${input.userId}
        AND ${codingDailyStats.date} >= ${fromDay}
        AND ${codingDailyStats.date} < ${toDay}
      ORDER BY ${codingDailyStats.date}
    `),
    executor.execute(sql`
      SELECT ${localDaySql(codingSessions.startedAt)}::text AS date,
        ${codingSessions.project} AS project,
        ${codingSessions.durationSeconds} AS "durationSeconds"
      FROM ${codingSessions}
      WHERE ${codingSessions.userId} = ${input.userId}
        AND ${codingSessions.startedAt} >= ${input.from}
        AND ${codingSessions.startedAt} < ${input.toExclusive}
        AND ${codingSessions.durationSeconds} >= 7200
      ORDER BY ${codingSessions.startedAt}, ${codingSessions.project}
    `),
  ]);

  const commitRows = rows(commitResult);
  const dailyCommits = new Map<string, number>();
  const commitTypes = new Map<string, number>();
  const projects = new Map<
    string,
    { commits: number; additions: number; deletions: number; first: string; last: string }
  >();
  const weekdays = Array.from({ length: 7 }, () => 0);
  const hours = Array.from({ length: 24 }, () => 0);
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const row of commitRows) {
    const count = numberValue(row.count);
    const date = String(row.date);
    const project = String(row.project);
    const type = String(row.commitType);
    dailyCommits.set(date, (dailyCommits.get(date) ?? 0) + count);
    commitTypes.set(type, (commitTypes.get(type) ?? 0) + count);
    weekdays[numberValue(row.weekday)] += count;
    hours[numberValue(row.hour)] += count;
    totalAdditions += numberValue(row.additions);
    totalDeletions += numberValue(row.deletions);
    const first = new Date(row.firstCommit as string | Date).toISOString();
    const last = new Date(row.lastCommit as string | Date).toISOString();
    const current = projects.get(project) ?? {
      commits: 0,
      additions: 0,
      deletions: 0,
      first,
      last,
    };
    current.commits += count;
    current.additions += numberValue(row.additions);
    current.deletions += numberValue(row.deletions);
    if (first < current.first) current.first = first;
    if (last > current.last) current.last = last;
    projects.set(project, current);
  }

  const languageTotals = new Map<string, number>();
  const quarterly = new Map<string, Map<string, number>>();
  let dailyProjectTotal = 0;
  let dailyLanguageTotal = 0;
  const codingRows = rows(codingResult).filter((row) => {
    const date = String(row.date);
    return date >= fromDay && date < toDay;
  });
  const dailyCodingSeconds = codingRows.map((row) => {
    const date = String(row.date);
    const languages = parseNamedSeconds(row.languages);
    const projectsForDay = parseNamedSeconds(row.projects);
    addNamed(languageTotals, languages);
    dailyProjectTotal += new Set(projectsForDay.map((item) => item.name)).size;
    dailyLanguageTotal += new Set(languages.map((item) => item.name)).size;
    const quarter = `Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
    const quarterLanguages = quarterly.get(quarter) ?? new Map<string, number>();
    addNamed(quarterLanguages, languages);
    quarterly.set(quarter, quarterLanguages);
    return { date, seconds: numberValue(row.seconds) };
  });

  const sortedCommitTypes = [...commitTypes]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  const projectList = [...projects]
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name));
  const result: CodingAggregate = {
    totalCommits: [...dailyCommits.values()].reduce((sum, value) => sum + value, 0),
    totalAdditions,
    totalDeletions,
    activeDays: dailyCommits.size,
    dailyCommits: [...dailyCommits]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    commitTypes: sortedCommitTypes,
    projects: projectList.map(({ first: _first, last: _last, ...project }) => project),
    totalCodingSeconds: dailyCodingSeconds.reduce((sum, day) => sum + day.seconds, 0),
    dailyCodingSeconds,
    languages: sortedNamed(languageTotals),
    deepWorkSessions: rows(sessionResult).map((row) => ({
      date: String(row.date),
      project: row.project == null ? null : String(row.project),
      durationSeconds: numberValue(row.durationSeconds),
    })),
    contextSwitching: {
      avgDailyProjects: codingRows.length > 0 ? dailyProjectTotal / codingRows.length : 0,
      avgDailyLanguages: codingRows.length > 0 ? dailyLanguageTotal / codingRows.length : 0,
    },
    weekdayHour: { weekdays, hours },
  };

  if (input.periodType === "year") {
    result.yearlyReport = {
      languageTrend: [...quarterly]
        .map(([quarter, languages]) => ({ quarter, languages: sortedNamed(languages) }))
        .sort((a, b) => a.quarter.localeCompare(b.quarter)),
      projectTimeline: projectList.map((project) => ({
        name: project.name,
        firstCommit: project.first,
        lastCommit: project.last,
        totalCommits: project.commits,
      })),
      commitTypes: sortedCommitTypes,
    };
  }

  return result;
}
