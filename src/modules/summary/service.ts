/**
 * Summary Service
 *
 * AI 요약 생성 및 관리
 */

import { and, eq, lt, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { commitSummaries, commits } from "@/db/schema";
import { CLAUDE_MODELS, createClaudeAdapter } from "@/lib/adapters/ai/claude";
import { createGitHubAdapter } from "@/lib/adapters/vcs/github";
import { logger } from "@/lib/logger";
import { now, parseRepoFullName, truncateDiff } from "@/lib/utils";
import { analyzeRecentCommits, fetchRepoContext } from "./context";
import {
  buildRecentContext,
  buildSummaryPrompt,
  buildSystemPrompt,
  type CommitContext,
  SIMPLE_SYSTEM_PROMPT,
} from "./prompts";

export interface SummaryResult {
  summary: string;
}

const MAX_RETRY_COUNT = 3;
const MAX_CHANGED_FILES_IN_PROMPT = 50;
// Stale `processing` rows older than this are revived to `pending`. Cron tick
// is 10 min and Anthropic timeout is 60s, so anything past 15 min is a
// crashed/killed worker, not in-flight work.
const PROCESSING_STALE_MS = 15 * 60 * 1000;

export class SummaryService {
  private db: Database;
  private anthropicApiKey: string;
  private githubAccessToken: string;

  constructor(db: Database, anthropicApiKey: string, githubAccessToken: string) {
    this.db = db;
    this.anthropicApiKey = anthropicApiKey;
    this.githubAccessToken = githubAccessToken;
  }

  private get aiAdapter() {
    return createClaudeAdapter(this.anthropicApiKey, CLAUDE_MODELS.COMMIT_SUMMARY);
  }

  private get vcsAdapter() {
    return createGitHubAdapter(this.githubAccessToken);
  }

  /**
   * 커밋에 대한 AI 요약 생성
   */
  async generateSummary(
    commitId: string,
    useEnhancedContext: boolean = true
  ): Promise<SummaryResult> {
    // 커밋 정보 조회
    const commitResult = await this.db
      .select({
        id: commits.id,
        sha: commits.sha,
        message: commits.message,
        additions: commits.additions,
        deletions: commits.deletions,
        changedFilesCount: commits.changedFilesCount,
        repoFullName: commits.repoFullName,
      })
      .from(commits)
      .where(eq(commits.id, commitId));

    if (commitResult.length === 0) {
      throw new Error("Commit not found");
    }

    const commit = commitResult[0];
    const { owner, repo } = parseRepoFullName(commit.repoFullName);

    // 요약 상태를 processing으로 업데이트
    await this.db
      .update(commitSummaries)
      .set({ status: "processing", updatedAt: now() })
      .where(eq(commitSummaries.commitId, commitId));

    try {
      // diff 가져오기
      const diffResult = await this.vcsAdapter.getCommitDiff(owner, repo, commit.sha);

      const truncatedDiff = truncateDiff(diffResult.rawDiff, 8000);
      // Cap the file list so a 200-file commit doesn't blow up the prompt
      // independently of the diff truncation.
      const allFiles = diffResult.files.map((f) => f.filename);
      const changedFiles =
        allFiles.length > MAX_CHANGED_FILES_IN_PROMPT
          ? [
              ...allFiles.slice(0, MAX_CHANGED_FILES_IN_PROMPT),
              `... 외 ${allFiles.length - MAX_CHANGED_FILES_IN_PROMPT}개 파일`,
            ]
          : allFiles;

      // 커밋 컨텍스트
      const commitContext: CommitContext = {
        message: commit.message.slice(0, 2000),
        changedFiles,
        additions: commit.additions ?? 0,
        deletions: commit.deletions ?? 0,
        diff: truncatedDiff,
      };

      let systemPrompt: string;
      let recentContext = "";

      if (useEnhancedContext) {
        // 고급 컨텍스트 수집
        const repoContext = await fetchRepoContext(
          this.vcsAdapter,
          owner,
          repo,
          "" // No longer have repo description
        );

        // 최근 커밋 패턴 분석 (파일이 5개 이상 변경된 복잡한 커밋에만)
        let recentPattern = null;
        if (changedFiles.length >= 5) {
          recentPattern = await analyzeRecentCommits(
            this.vcsAdapter,
            owner,
            repo,
            changedFiles,
            commit.sha
          );
        }

        systemPrompt = buildSystemPrompt(repoContext);
        recentContext = buildRecentContext(recentPattern);
      } else {
        systemPrompt = SIMPLE_SYSTEM_PROMPT;
      }

      // AI 요약 생성
      const summaryResult = await this.aiAdapter.generateText({
        system: systemPrompt,
        prompt: buildSummaryPrompt(commitContext, recentContext),
        maxTokens: 300,
        // 짧은 정형 출력이라 사고가 필요 없어 thinking을 껐다. 그 덕에
        // maxTokens 300 전부가 응답 몫으로 남는다. effort low는 (thinking과
        // 별개로) 추론에 쓰는 연산량 자체의 상한이다.
        thinking: "disabled",
        effort: "low",
      });

      // 빈 응답을 completed로 저장하면 그 요약은 cron의 pending/failed 재스캔
      // 대상에서 영구히 빠진다. 거절(HTTP 200, 텍스트 블록 없음), thinking이
      // max_tokens를 다 써버린 truncation, 앞으로 생길 응답 형태 변화까지
      // stopReason 종류를 가리지 않고 "비어 있으면" 실패로 던져 아래 catch가
      // failed 처리·재시도를 맡게 한다.
      if (!summaryResult.content.trim()) {
        throw new Error(`AI returned an empty summary (stopReason: ${summaryResult.stopReason})`);
      }

      const result: SummaryResult = {
        summary: summaryResult.content,
      };

      // 요약 저장
      await this.db
        .update(commitSummaries)
        .set({
          summary: result.summary,
          status: "completed",
          updatedAt: now(),
        })
        .where(eq(commitSummaries.commitId, commitId));

      return result;
    } catch (error) {
      // Atomic retry increment. After MAX_RETRY_COUNT attempts the row stays
      // in `failed` and drops out of the pending/failed queue scan in cron —
      // manual regenerateSummary resets retry_count and is the only way back
      // in. Below the cap we keep status='failed' too; the cron `inArray
      // (['pending','failed'])` filter still picks it up next tick.
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await this.db
        .update(commitSummaries)
        .set({
          status: "failed",
          retryCount: sql`${commitSummaries.retryCount} + 1`,
          errorMessage: errorMessage.slice(0, 1000),
          updatedAt: now(),
        })
        .where(eq(commitSummaries.commitId, commitId));

      // Visibility: the cron path used to swallow these into a console.error
      // that never reached Better Stack. Surface them.
      logger.warn("[Summary] generateSummary failed", {
        commitId,
        repoFullName: commit.repoFullName,
        sha: commit.sha,
        error: errorMessage,
      });

      throw error;
    }
  }

  /**
   * Revive `processing` rows abandoned by a crashed/killed worker. We mark
   * status='processing' before the AI call and only flip back to 'failed' in
   * the catch — if the process dies mid-call the row is stuck out of the
   * queue forever. Cron should call this at the top of each tick.
   */
  static async reviveStaleProcessing(db: Database): Promise<number> {
    const cutoff = new Date(Date.now() - PROCESSING_STALE_MS);
    const revived = await db
      .update(commitSummaries)
      .set({ status: "pending", updatedAt: now() })
      .where(and(eq(commitSummaries.status, "processing"), lt(commitSummaries.updatedAt, cutoff)))
      .returning({ id: commitSummaries.id });
    if (revived.length > 0) {
      logger.info("[Summary] revived stale processing rows", { count: revived.length });
    }
    return revived.length;
  }

  /**
   * Whether a commit's summary should be skipped from the queue (terminal
   * failure that exceeded retry budget). Used by cron to filter out poison
   * commits without re-enqueuing them on every tick.
   */
  static isTerminalRetryCount(retryCount: number): boolean {
    return retryCount >= MAX_RETRY_COUNT;
  }

  /**
   * Manual regeneration: resets retryCount and clears the error so a
   * user-initiated retry on a `failed` row actually proceeds. Automatic
   * retries are handled by MAX_RETRY_COUNT inside generateSummary's catch.
   */
  async regenerateSummary(commitId: string): Promise<SummaryResult> {
    const [summary] = await this.db
      .select({ id: commitSummaries.id })
      .from(commitSummaries)
      .where(eq(commitSummaries.commitId, commitId))
      .limit(1);

    if (!summary) {
      throw new Error("Summary record not found");
    }

    await this.db
      .update(commitSummaries)
      .set({
        status: "processing",
        retryCount: 0,
        errorMessage: null,
        updatedAt: now(),
      })
      .where(eq(commitSummaries.commitId, commitId));

    return this.generateSummary(commitId);
  }

  /**
   * Process queued summaries (status pending or failed-but-retriable).
   *
   * Caller can scope to a single user via `userId`; `limit` caps work per
   * invocation so the cron tick can't spend its whole budget on one user.
   * Rows past MAX_RETRY_COUNT stay `failed` and are skipped here.
   */
  async processPendingSummaries(
    limit: number = 10,
    onProgress?: (processed: number, total: number) => void,
    userId?: string
  ): Promise<number> {
    const userFilter = userId ? eq(commits.userId, userId) : undefined;
    const queued = await this.db
      .select({ commitId: commitSummaries.commitId })
      .from(commitSummaries)
      .innerJoin(commits, eq(commits.id, commitSummaries.commitId))
      .where(
        and(
          sql`${commitSummaries.status} IN ('pending','failed')`,
          lt(commitSummaries.retryCount, MAX_RETRY_COUNT),
          ...(userFilter ? [userFilter] : [])
        )
      )
      .orderBy(commits.committedAt)
      .limit(limit);

    if (queued.length === 0) {
      return 0;
    }

    let processed = 0;

    for (const { commitId } of queued) {
      try {
        await this.generateSummary(commitId);
        processed++;
        onProgress?.(processed, queued.length);
      } catch (_error) {
        // generateSummary already logged + persisted error_message + retry_count
      }

      // Rate limiting - 요청 간 1초 대기
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return processed;
  }
}

export function createSummaryService(
  db: Database,
  anthropicApiKey: string,
  githubAccessToken: string
): SummaryService {
  return new SummaryService(db, anthropicApiKey, githubAccessToken);
}
