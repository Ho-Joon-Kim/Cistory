/**
 * Summary Service
 *
 * AI 요약 생성 및 관리
 */

import { eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { commitSummaries, commits } from "@/db/schema";
import { createClaudeAdapter } from "@/lib/adapters/ai/claude";
import { createGitHubAdapter } from "@/lib/adapters/vcs/github";
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
    return createClaudeAdapter(this.anthropicApiKey);
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
      const changedFiles = diffResult.files.map((f) => f.filename);

      // 커밋 컨텍스트
      const commitContext: CommitContext = {
        message: commit.message,
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
        temperature: 0.5,
      });

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
      // Atomic retry increment + terminal failure after MAX_RETRY_COUNT.
      //
      // Previous behavior: select-then-update raced against concurrent cron
      // workers, and the "flip status to pending" path meant the cron would
      // immediately re-enqueue and loop forever on a persistent upstream error.
      // Now we increment in-place and leave the row as `failed` so it drops
      // out of the pending queue. Manual regenerate (regenerateSummary) is
      // still available and resets the counter.
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await this.db
        .update(commitSummaries)
        .set({
          status: "failed",
          retryCount: sql`${commitSummaries.retryCount} + 1`,
          errorMessage,
          updatedAt: now(),
        })
        .where(eq(commitSummaries.commitId, commitId));

      throw error;
    }
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
   * pending 상태의 요약 일괄 처리
   */
  async processPendingSummaries(
    limit: number = 10,
    onProgress?: (processed: number, total: number) => void
  ): Promise<number> {
    // pending 상태의 요약 조회
    const pending = await this.db
      .select({ commitId: commitSummaries.commitId })
      .from(commitSummaries)
      .where(eq(commitSummaries.status, "pending"))
      .limit(limit);

    if (pending.length === 0) {
      return 0;
    }

    let processed = 0;

    for (const { commitId } of pending) {
      try {
        await this.generateSummary(commitId);
        processed++;
        onProgress?.(processed, pending.length);
      } catch (error) {
        console.error(`Failed to generate summary for ${commitId}:`, error);
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
