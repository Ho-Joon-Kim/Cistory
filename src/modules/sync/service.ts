import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db";
import {
  commitSummaries,
  commits,
  type NewCommit,
  type NewCommitSummary,
  type NewSyncJob,
  syncJobs,
  users,
} from "@/db/schema";
import { createGitHubAdapter, type VCSSearchCommit } from "@/lib/adapters/vcs/github";
import { generateId, now } from "@/lib/utils";

export interface SyncProgress {
  status: "fetching" | "summarizing" | "completed" | "failed";
  message: string;
  totalCommits: number;
  processedCommits: number;
}

export type SyncType = "events" | "search" | "initial";
export type TriggerType = "manual" | "scheduled" | "login";

/**
 * Lookback overlap for incremental sync. GitHub's commit-list `since` filters
 * by commit (author) date and the API offers no push-time filter, so a commit
 * authored days ago but pushed after the last sync would be missed if we
 * queried from lastSyncedAt exactly. Pulling the window back 72h re-fetches
 * recent commits as overlap; SHA-based dedup (getExistingCommitShas) makes the
 * duplicate fetches safe.
 */
const INCREMENTAL_SYNC_LOOKBACK_MS = 72 * 60 * 60 * 1000;

/**
 * Bounded concurrency for per-commit stats fetches. GitHub's secondary rate
 * limits are sensitive to high concurrency, so keep this conservative.
 */
const STATS_FETCH_CONCURRENCY = 3;

export class SyncService {
  private db: Database;
  private accessToken: string;

  constructor(db: Database, accessToken: string) {
    this.db = db;
    this.accessToken = accessToken;
  }

  private get vcsAdapter() {
    return createGitHubAdapter(this.accessToken);
  }

  /**
   * Initial sync for new users - fetches last 3 months of commits via Search API
   */
  async initialSync(
    userId: string,
    username: string,
    onProgress?: (progress: SyncProgress) => void
  ): Promise<{ newCommits: number; syncJobId: string }> {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    return this._executeSyncCommits({
      userId,
      username,
      syncType: "initial",
      triggerType: "login",
      sinceDate: threeMonthsAgo.toISOString(),
      markInitialComplete: true,
      fetchingMessage: "최근 3개월 커밋을 검색하는 중...",
      completedMessage: (count) => `${count}개의 커밋을 동기화했습니다`,
      onProgress,
    });
  }

  /**
   * Regular sync using Search API - fetches commits since last sync
   */
  async syncUserCommits(
    userId: string,
    username: string,
    triggerType: TriggerType = "manual",
    onProgress?: (progress: SyncProgress) => void
  ): Promise<{ newCommits: number; syncJobId: string }> {
    // Get user's last sync time
    const userResult = await this.db
      .select({ lastSyncedAt: users.lastSyncedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    // Default to 7 days ago if no lastSyncedAt
    let sinceDate: string;
    const lastSyncedAt = userResult[0]?.lastSyncedAt;
    if (lastSyncedAt) {
      // Pull `since` back by the lookback overlap so commits authored before
      // the last sync but pushed after it are still picked up (see
      // INCREMENTAL_SYNC_LOOKBACK_MS).
      const lastSyncTime =
        lastSyncedAt instanceof Date ? lastSyncedAt : new Date(String(lastSyncedAt));
      sinceDate = new Date(lastSyncTime.getTime() - INCREMENTAL_SYNC_LOOKBACK_MS).toISOString();
    } else {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      sinceDate = sevenDaysAgo.toISOString();
    }

    console.log("[Sync] Searching commits since:", sinceDate, "for user:", username);

    return this._executeSyncCommits({
      userId,
      username,
      syncType: "search",
      triggerType,
      sinceDate,
      markInitialComplete: false,
      fetchingMessage: "새로운 커밋을 검색하는 중...",
      completedMessage: (count) => `${count}개의 새로운 커밋을 동기화했습니다`,
      onProgress,
    });
  }

  private async _executeSyncCommits(options: {
    userId: string;
    username: string;
    syncType: SyncType;
    triggerType: TriggerType;
    sinceDate: string;
    markInitialComplete: boolean;
    fetchingMessage: string;
    completedMessage: (count: number) => string;
    onProgress?: (progress: SyncProgress) => void;
  }): Promise<{ newCommits: number; syncJobId: string }> {
    const {
      userId,
      username,
      syncType,
      triggerType,
      sinceDate,
      markInitialComplete,
      fetchingMessage,
      completedMessage,
      onProgress,
    } = options;

    const syncJobId = generateId();
    const timestamp = now();

    await this.db.insert(syncJobs).values({
      id: syncJobId,
      userId,
      syncType,
      status: "fetching",
      triggerType,
      startedAt: timestamp,
      createdAt: timestamp,
    } satisfies NewSyncJob);

    onProgress?.({
      status: "fetching",
      message: fetchingMessage,
      totalCommits: 0,
      processedCommits: 0,
    });

    try {
      // Fetch commits via Repos API (iterates repos, fetches commits per repo)
      const allSearchCommits = await this.vcsAdapter.getAllRepoCommits(username, {
        since: sinceDate,
      });

      onProgress?.({
        status: "fetching",
        message: `커밋 검색 완료 (${allSearchCommits.length}개 발견)`,
        totalCommits: allSearchCommits.length,
        processedCommits: 0,
      });

      console.log("[Sync] Found", allSearchCommits.length, "commits from Repos API");

      // Filter out already existing commits
      const existingShas = await this.getExistingCommitShas(
        userId,
        allSearchCommits.map((c) => c.sha)
      );
      const newSearchCommits = allSearchCommits.filter((c) => !existingShas.has(c.sha));

      console.log(
        "[Sync] After filtering:",
        newSearchCommits.length,
        "new commits (",
        existingShas.size,
        "already exist)"
      );

      if (newSearchCommits.length === 0) {
        await this.completeSyncJob(syncJobId, 0, 0);

        const userUpdate: Record<string, unknown> = { lastSyncedAt: now(), updatedAt: now() };
        if (markInitialComplete) userUpdate.initialSyncCompleted = true;
        await this.db.update(users).set(userUpdate).where(eq(users.id, userId));

        onProgress?.({
          status: "completed",
          message: "새로운 커밋이 없습니다",
          totalCommits: 0,
          processedCommits: 0,
        });

        return { newCommits: 0, syncJobId };
      }

      // Update sync job with total count
      await this.db
        .update(syncJobs)
        .set({ totalCommits: newSearchCommits.length })
        .where(eq(syncJobs.id, syncJobId));

      // Save commits with stats. Each save fetches per-commit stats from the
      // GitHub API, so run small batches concurrently (STATS_FETCH_CONCURRENCY)
      // instead of one-by-one, while keeping the 100ms pause between batches to
      // stay clear of GitHub's secondary rate limits. Repo/branch traversal in
      // getAllRepoCommits stays fully sequential for the same reason.
      let processed = 0;
      for (let i = 0; i < newSearchCommits.length; i += STATS_FETCH_CONCURRENCY) {
        const batch = newSearchCommits.slice(i, i + STATS_FETCH_CONCURRENCY);

        onProgress?.({
          status: "fetching",
          message: `커밋 저장 및 통계 수집 중... (${processed + 1}/${newSearchCommits.length})`,
          totalCommits: newSearchCommits.length,
          processedCommits: processed,
        });

        await Promise.all(
          batch.map((searchCommit) => this.saveSearchCommit(userId, searchCommit, true))
        );
        processed += batch.length;

        // Small delay between batches to avoid rate limiting
        if (processed < newSearchCommits.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      // Update user sync state
      const userUpdate: Record<string, unknown> = { lastSyncedAt: now(), updatedAt: now() };
      if (markInitialComplete) userUpdate.initialSyncCompleted = true;
      await this.db.update(users).set(userUpdate).where(eq(users.id, userId));

      // Complete sync job
      await this.completeSyncJob(syncJobId, newSearchCommits.length, processed);

      onProgress?.({
        status: "completed",
        message: completedMessage(newSearchCommits.length),
        totalCommits: newSearchCommits.length,
        processedCommits: processed,
      });

      return { newCommits: newSearchCommits.length, syncJobId };
    } catch (error) {
      await this.failSyncJob(syncJobId, error instanceof Error ? error.message : "Unknown error");

      onProgress?.({
        status: "failed",
        message: `동기화 실패: ${error instanceof Error ? error.message : "Unknown error"}`,
        totalCommits: 0,
        processedCommits: 0,
      });

      throw error;
    }
  }

  private async getExistingCommitShas(userId: string, shas: string[]): Promise<Set<string>> {
    if (shas.length === 0) return new Set();

    // Batch query to avoid too large IN clause
    const batchSize = 500;
    const existingShas = new Set<string>();

    for (let i = 0; i < shas.length; i += batchSize) {
      const batch = shas.slice(i, i + batchSize);
      const existing = await this.db
        .select({ sha: commits.sha })
        .from(commits)
        .where(and(eq(commits.userId, userId), inArray(commits.sha, batch)));

      for (const row of existing) {
        existingShas.add(row.sha);
      }
    }

    return existingShas;
  }

  private async saveSearchCommit(
    userId: string,
    searchCommit: VCSSearchCommit,
    fetchStats: boolean = true
  ): Promise<string> {
    const commitId = generateId();
    const timestamp = now();

    // Fetch commit stats from GitHub API if requested
    let additions = 0;
    let deletions = 0;
    let changedFilesCount = 0;

    if (fetchStats) {
      try {
        const [owner, repo] = searchCommit.repoFullName.split("/");
        const stats = await this.vcsAdapter.getCommitDetail(owner, repo, searchCommit.sha);
        additions = stats.additions;
        deletions = stats.deletions;
        changedFilesCount = stats.changedFilesCount;
      } catch (error) {
        // If fetching stats fails, continue with zeros
        console.warn(`[Sync] Failed to fetch stats for ${searchCommit.sha}:`, error);
      }
    }

    // Save commit (onConflictDoNothing handles race conditions with concurrent syncs)
    const insertResult = await this.db
      .insert(commits)
      .values({
        id: commitId,
        userId,
        sha: searchCommit.sha,
        message: searchCommit.message,
        authorName: searchCommit.authorName,
        authorEmail: searchCommit.authorEmail,
        authorAvatarUrl: searchCommit.authorAvatarUrl,
        committedAt: new Date(searchCommit.committedAt),
        additions,
        deletions,
        changedFilesCount,
        isMergeCommit: searchCommit.isMergeCommit,
        parentShas: JSON.stringify(searchCommit.parentShas),
        repoFullName: searchCommit.repoFullName,
        repoId: searchCommit.repoId,
        repoIsPrivate: searchCommit.repoIsPrivate,
        createdAt: timestamp,
      } satisfies NewCommit)
      .onConflictDoNothing({ target: [commits.userId, commits.sha] });

    // Only create summary if commit was actually inserted (not a duplicate)
    if (insertResult.rowCount && insertResult.rowCount > 0) {
      await this.db.insert(commitSummaries).values({
        id: generateId(),
        commitId,
        status: "pending",
        createdAt: timestamp,
        updatedAt: timestamp,
      } satisfies NewCommitSummary);
    }

    return commitId;
  }

  private async completeSyncJob(
    syncJobId: string,
    totalCommits: number,
    processedCommits: number
  ): Promise<void> {
    await this.db
      .update(syncJobs)
      .set({
        status: "completed",
        totalCommits,
        processedCommits,
        completedAt: now(),
      })
      .where(eq(syncJobs.id, syncJobId));
  }

  private async failSyncJob(syncJobId: string, errorMessage: string): Promise<void> {
    await this.db
      .update(syncJobs)
      .set({
        status: "failed",
        errorMessage,
        completedAt: now(),
      })
      .where(eq(syncJobs.id, syncJobId));
  }
}

export function createSyncService(db: Database, accessToken: string): SyncService {
  return new SyncService(db, accessToken);
}
