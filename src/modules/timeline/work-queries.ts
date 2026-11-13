/**
 * Read-only "work" queries — commits with AI summaries and WakaTime coding
 * stats/sessions — shared by the web routes and the MCP tools. Every function
 * is scoped to the given `userId`.
 */

import { and, asc, desc, eq, gt, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { type Database, getDb } from "@/db";
import { codingDailyStats, codingSessions, commitSummaries, commits } from "@/db/schema";

// ── Commits ─────────────────────────────────────────────────────────────────

export interface CommitListQuery {
  page: number;
  perPage: number;
  /** Only these `owner/repo` names. */
  repos?: string[];
  /** Strictly after this instant. */
  after?: Date | null;
  /** At or after this instant. */
  from?: Date | null;
  /** At or before this instant. */
  to?: Date | null;
}

export interface TimelineCommit {
  id: string;
  sha: string;
  message: string;
  authorName: string | null;
  authorAvatarUrl: string | null;
  committedAt: Date;
  additions: number | null;
  deletions: number | null;
  changedFilesCount: number | null;
  isMergeCommit: boolean | null;
  repository: { fullName: string; id: number | null; isPrivate: boolean | null };
  summary: { status: string | null; summary: string | null } | null;
}

/** Newest-first page of commits with their AI summaries, plus pagination. */
export async function listCommits(
  userId: string,
  query: CommitListQuery,
  database: Database = getDb()
) {
  const { page, perPage } = query;
  const conditions = [eq(commits.userId, userId)];
  if (query.repos && query.repos.length > 0) {
    conditions.push(inArray(commits.repoFullName, query.repos));
  }
  if (query.after) conditions.push(gt(commits.committedAt, query.after));
  if (query.from) conditions.push(gte(commits.committedAt, query.from));
  if (query.to) conditions.push(lte(commits.committedAt, query.to));

  const countQuery = database
    .select({ count: sql<number>`count(*)` })
    .from(commits)
    .where(and(...conditions));

  const offset = (page - 1) * perPage;

  // Independent of the count — run both at once.
  const pageQuery = database
    .select({
      id: commits.id,
      sha: commits.sha,
      message: commits.message,
      authorName: commits.authorName,
      authorAvatarUrl: commits.authorAvatarUrl,
      committedAt: commits.committedAt,
      additions: commits.additions,
      deletions: commits.deletions,
      changedFilesCount: commits.changedFilesCount,
      isMergeCommit: commits.isMergeCommit,
      repoFullName: commits.repoFullName,
      repoId: commits.repoId,
      repoIsPrivate: commits.repoIsPrivate,
      summaryId: commitSummaries.id,
      summaryStatus: commitSummaries.status,
      summary: commitSummaries.summary,
    })
    .from(commits)
    .leftJoin(commitSummaries, eq(commits.id, commitSummaries.commitId))
    .where(and(...conditions))
    .orderBy(desc(commits.committedAt))
    .limit(perPage)
    .offset(offset);

  const [countResult, rows] = await Promise.all([countQuery, pageQuery]);
  const total = countResult[0]?.count ?? 0;
  const totalPages = Math.ceil(total / perPage);

  return {
    commits: rows.map(
      (c): TimelineCommit => ({
        id: c.id,
        sha: c.sha,
        message: c.message,
        authorName: c.authorName,
        authorAvatarUrl: c.authorAvatarUrl,
        committedAt: c.committedAt,
        additions: c.additions,
        deletions: c.deletions,
        changedFilesCount: c.changedFilesCount,
        isMergeCommit: c.isMergeCommit,
        repository: {
          fullName: c.repoFullName,
          id: c.repoId,
          isPrivate: c.repoIsPrivate,
        },
        summary: c.summaryId ? { status: c.summaryStatus, summary: c.summary } : null,
      })
    ),
    pagination: {
      page,
      perPage,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

// ── Coding stats (WakaTime daily) ───────────────────────────────────────────

export interface CodingSummaryItem {
  name: string;
  totalSeconds: number;
}

export interface CodingDayStats {
  date: string;
  totalSeconds: number;
  projects: CodingSummaryItem[];
  languages: CodingSummaryItem[];
  editors: CodingSummaryItem[];
  categories: CodingSummaryItem[];
}

function parseSummaryJson(raw: string | null): CodingSummaryItem[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as CodingSummaryItem[];
  } catch {
    return [];
  }
}

/** Daily coding stats for `from`..`to` (inclusive `YYYY-MM-DD` keys), oldest first. */
export async function getCodingStats(
  userId: string,
  from: string,
  to: string,
  database: Database = getDb()
): Promise<CodingDayStats[]> {
  const rows = await database
    .select({
      date: codingDailyStats.date,
      totalSeconds: codingDailyStats.totalSeconds,
      projects: codingDailyStats.projects,
      languages: codingDailyStats.languages,
      editors: codingDailyStats.editors,
      categories: codingDailyStats.categories,
    })
    .from(codingDailyStats)
    .where(
      and(
        eq(codingDailyStats.userId, userId),
        gte(codingDailyStats.date, from),
        lte(codingDailyStats.date, to)
      )
    )
    .orderBy(asc(codingDailyStats.date));

  return rows.map((r) => ({
    date: r.date,
    totalSeconds: r.totalSeconds,
    projects: parseSummaryJson(r.projects),
    languages: parseSummaryJson(r.languages),
    editors: parseSummaryJson(r.editors),
    categories: parseSummaryJson(r.categories),
  }));
}

// ── Coding sessions ─────────────────────────────────────────────────────────

export interface CodingSessionView {
  id: string;
  project: string | null;
  startedAt: string;
  durationSeconds: number;
  humanAdditions: number | null;
  humanDeletions: number | null;
  aiAdditions: number | null;
  aiDeletions: number | null;
}

/** Coding sessions starting in `[start, end)`, oldest first. */
export async function listCodingSessions(
  userId: string,
  range: { start: Date; end: Date },
  database: Database = getDb()
): Promise<CodingSessionView[]> {
  const rows = await database
    .select({
      id: codingSessions.id,
      project: codingSessions.project,
      startedAt: codingSessions.startedAt,
      durationSeconds: codingSessions.durationSeconds,
      humanAdditions: codingSessions.humanAdditions,
      humanDeletions: codingSessions.humanDeletions,
      aiAdditions: codingSessions.aiAdditions,
      aiDeletions: codingSessions.aiDeletions,
    })
    .from(codingSessions)
    .where(
      and(
        eq(codingSessions.userId, userId),
        gte(codingSessions.startedAt, range.start),
        lt(codingSessions.startedAt, range.end)
      )
    )
    .orderBy(asc(codingSessions.startedAt));

  return rows.map((r) => ({
    id: r.id,
    project: r.project,
    startedAt: r.startedAt.toISOString(),
    durationSeconds: r.durationSeconds,
    humanAdditions: r.humanAdditions,
    humanDeletions: r.humanDeletions,
    aiAdditions: r.aiAdditions,
    aiDeletions: r.aiDeletions,
  }));
}
