/**
 * Work read tool: `work` — commits with their AI summaries (paged, newest
 * first) plus WakaTime daily coding stats and, optionally, coding sessions.
 */

import { z } from "zod";
import {
  getCodingStats,
  listCodingSessions,
  listCommits,
  type TimelineCommit,
} from "@/modules/timeline/work-queries";
import { type Allowlist, accessFromScopes, serializeRows } from "../serialize";
import { defineTool, type McpTool } from "../server";
import { parseTimeRange } from "../time";
import {
  cursorField,
  decodeOffsetCursor,
  encodeOffsetCursor,
  kstIso,
  kstTime,
  limitField,
  NO_RECORDS,
  PAGE_DEFAULT_LIMIT,
  RANGE_ARG_RULES,
  READ_ANNOTATIONS,
  rangeFields,
  rangeOutput,
} from "./common";

const WORK_MAX_DAYS = 366;

const COMMIT_ALLOWLIST: Allowlist<TimelineCommit> = {
  sha: true,
  repository: { map: (v) => (v as TimelineCommit["repository"]).fullName },
  isPrivateRepository: {
    from: "repository",
    map: (v) => (v as TimelineCommit["repository"]).isPrivate,
  },
  message: true,
  committedAt: kstTime,
  additions: true,
  deletions: true,
  changedFilesCount: true,
  isMergeCommit: true,
  aiSummary: {
    from: "summary",
    map: (v) => {
      const s = v as TimelineCommit["summary"];
      return s?.status === "completed" ? s.summary : null;
    },
  },
  aiSummaryStatus: {
    from: "summary",
    map: (v) => (v as TimelineCommit["summary"])?.status ?? null,
  },
};

export const workTool = defineTool({
  name: "work",
  kind: "read",
  scope: "read",
  title: "작업 기록",
  description:
    "기간(기본 최근 7일, 최대 366일)의 GitHub 커밋과 AI 요약(최근 순, 커서 페이지 기본 100건·최대 500건), " +
    "WakaTime 일별 코딩 시간(프로젝트·언어별)을 돌려줍니다. includeSessions=true면 코딩 세션도 줍니다.",
  annotations: READ_ANNOTATIONS,
  inputSchema: z.object({
    ...rangeFields,
    repo: z
      .string()
      .max(300)
      .regex(/^[\w.-]+\/[\w.-]+$/)
      .optional()
      .describe("이 저장소(owner/name)의 커밋만."),
    includeSessions: z.boolean().optional().describe("코딩 세션 목록도 받을지 (기본 false)."),
    limit: limitField(),
    cursor: cursorField,
  }),
  argRules: { ...RANGE_ARG_RULES, repo: "keep", includeSessions: "keep" },
  run: async (ctx, input) => {
    const range = parseTimeRange(input, { now: ctx.now, maxDays: WORK_MAX_DAYS });
    const perPage = input.limit ?? PAGE_DEFAULT_LIMIT;
    const offset = decodeOffsetCursor(input.cursor);
    // listCommits pages by page number; cursors are always page-aligned offsets.
    const page = Math.floor(offset / perPage) + 1;
    const lastInstant = new Date(range.end.getTime() - 1);

    const [commitPage, codingDays, sessions] = await Promise.all([
      listCommits(
        ctx.userId,
        {
          page,
          perPage,
          repos: input.repo ? [input.repo] : undefined,
          from: range.start,
          to: lastInstant,
        },
        ctx.db
      ),
      getCodingStats(ctx.userId, range.fromDate, range.toDate, ctx.db),
      input.includeSessions ? listCodingSessions(ctx.userId, range, ctx.db) : Promise.resolve(null),
    ]);

    const commits = serializeRows(
      commitPage.commits,
      COMMIT_ALLOWLIST,
      accessFromScopes(ctx.scopes)
    );
    const totalCodingSeconds = codingDays.reduce((n, d) => n + d.totalSeconds, 0);
    return {
      structured: {
        range: rangeOutput(range),
        commits,
        totalCommits: commitPage.pagination.total,
        coding: {
          totalSeconds: totalCodingSeconds,
          days: codingDays.map((d) => ({
            date: d.date,
            totalSeconds: d.totalSeconds,
            projects: d.projects,
            languages: d.languages,
          })),
        },
        sessions:
          sessions?.map((s) => ({
            project: s.project,
            startedAt: kstIso(s.startedAt),
            durationSeconds: s.durationSeconds,
            humanAdditions: s.humanAdditions,
            humanDeletions: s.humanDeletions,
            aiAdditions: s.aiAdditions,
            aiDeletions: s.aiDeletions,
          })) ?? null,
        message: commitPage.pagination.total === 0 && codingDays.length === 0 ? NO_RECORDS : null,
        nextCursor: commitPage.pagination.hasNext ? encodeOffsetCursor(page * perPage) : null,
      },
      count: commits.length,
    };
  },
});

export const WORK_TOOLS: McpTool[] = [workTool];
