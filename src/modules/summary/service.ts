/**
 * Summary Service
 *
 * AI 요약 생성 및 관리
 */

import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { commitSummaries, commits } from "@/db/schema";
import { createClaudeAdapter } from "@/lib/adapters/ai/claude";
import { createGitHubAdapter } from "@/lib/adapters/vcs/github";
import { now, truncateDiff, parseRepoFullName } from "@/lib/utils";
import {
  buildSystemPrompt,
  buildRecentContext,
  buildNonTechnicalPrompt,
  buildTechnicalPrompt,
  SIMPLE_SYSTEM_PROMPT,
  type RepoContext,
  type CommitContext,
} from "./prompts";
import { fetchRepoContext, analyzeRecentCommits } from "./context";

const MAX_RETRY_COUNT = 3;

export interface SummaryResult {
  technical: string;
  nonTechnical: string;
}

export class SummaryService {
  private db: Database;
  private anthropicApiKey: string;
  private githubAccessToken: string;

  constructor(
    db: Database,
    anthropicApiKey: string,
    githubAccessToken: string
  ) {
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
      const diffResult = await this.vcsAdapter.getCommitDiff(
        owner,
        repo,
        commit.sha
      );

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

      // AI 요약 생성 (병렬)
      const [technicalResult, nonTechnicalResult] = await Promise.all([
        this.aiAdapter.generateText({
          system: systemPrompt,
          prompt: buildTechnicalPrompt(commitContext, recentContext),
          maxTokens: 500,
          temperature: 0.5,
        }),
        this.aiAdapter.generateText({
          system: systemPrompt,
          prompt: buildNonTechnicalPrompt(commitContext, recentContext),
          maxTokens: 300,
          temperature: 0.5,
        }),
      ]);

      const result: SummaryResult = {
        technical: technicalResult.content,
        nonTechnical: nonTechnicalResult.content,
      };

      // 요약 저장
      await this.db
        .update(commitSummaries)
        .set({
          technicalSummary: result.technical,
          nonTechnicalSummary: result.nonTechnical,
          status: "completed",
          updatedAt: now(),
        })
        .where(eq(commitSummaries.commitId, commitId));

      return result;
    } catch (error) {
      // 실패 처리
      const summary = await this.db
        .select()
        .from(commitSummaries)
        .where(eq(commitSummaries.commitId, commitId));

      const currentRetry = summary[0]?.retryCount ?? 0;

      await this.db
        .update(commitSummaries)
        .set({
          status: currentRetry >= MAX_RETRY_COUNT - 1 ? "failed" : "pending",
          retryCount: currentRetry + 1,
          errorMessage: error instanceof Error ? error.message : "Unknown error",
          updatedAt: now(),
        })
        .where(eq(commitSummaries.commitId, commitId));

      throw error;
    }
  }

  /**
   * 요약 재생성
   */
  async regenerateSummary(commitId: string): Promise<SummaryResult> {
    // 재시도 횟수 확인
    const summary = await this.db
      .select()
      .from(commitSummaries)
      .where(eq(commitSummaries.commitId, commitId));

    if (summary.length === 0) {
      throw new Error("Summary record not found");
    }

    if ((summary[0].retryCount ?? 0) >= MAX_RETRY_COUNT) {
      throw new Error("Maximum retry count exceeded");
    }

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
