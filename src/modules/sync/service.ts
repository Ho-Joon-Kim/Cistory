import { eq, desc, and, inArray } from "drizzle-orm";
import type { Database } from "@/db";
import {
  users,
  commits,
  commitSummaries,
  syncJobs,
  type NewCommit,
  type NewCommitSummary,
  type NewSyncJob,
} from "@/db/schema";
import { createGitHubAdapter } from "@/lib/adapters/vcs/github";
import type { VCSSearchCommit } from "@/lib/adapters/vcs/interface";
import { generateId, now } from "@/lib/utils";

export interface SyncProgress {
  status: "pending" | "fetching" | "summarizing" | "completed" | "failed";
  message: string;
  totalCommits: number;
  processedCommits: number;
}

export type SyncType = "events" | "search" | "initial";
export type TriggerType = "manual" | "scheduled" | "login";

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
    // Create sync job
    const syncJobId = generateId();
    const timestamp = now();

    await this.db.insert(syncJobs).values({
      id: syncJobId,
      userId,
      syncType: "initial",
      status: "fetching",
      triggerType: "login",
      startedAt: timestamp,
      createdAt: timestamp,
    } satisfies NewSyncJob);

    onProgress?.({
      status: "fetching",
      message: "최근 3개월 커밋을 검색하는 중...",
      totalCommits: 0,
      processedCommits: 0,
    });

    try {
      // Calculate 3 months ago
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const sinceDate = threeMonthsAgo.toISOString();

      // Fetch commits via Search API (paginated)
      const allSearchCommits: VCSSearchCommit[] = [];
      let page = 1;
      const perPage = 100;
      let hasMore = true;

      while (hasMore) {
        const searchCommits = await this.vcsAdapter.searchUserCommits(username, {
          since: sinceDate,
          perPage,
          page,
        });

        allSearchCommits.push(...searchCommits);

        onProgress?.({
          status: "fetching",
          message: `커밋 검색 중... (${allSearchCommits.length}개 발견)`,
          totalCommits: allSearchCommits.length,
          processedCommits: 0,
        });

        // GitHub Search API returns max 1000 results
        if (searchCommits.length < perPage || allSearchCommits.length >= 1000) {
          hasMore = false;
        } else {
          page++;
        }
      }

      // Filter out already existing commits
      const existingShas = await this.getExistingCommitShas(
        userId,
        allSearchCommits.map((c) => c.sha)
      );
      const newSearchCommits = allSearchCommits.filter(
        (c) => !existingShas.has(c.sha)
      );

      if (newSearchCommits.length === 0) {
        await this.completeSyncJob(syncJobId, 0, 0);
        onProgress?.({
          status: "completed",
          message: "새로운 커밋이 없습니다",
          totalCommits: 0,
          processedCommits: 0,
        });

        // Mark initial sync as completed
        await this.db
          .update(users)
          .set({ initialSyncCompleted: true, lastSyncedAt: now(), updatedAt: now() })
          .where(eq(users.id, userId));

        return { newCommits: 0, syncJobId };
      }

      // Update sync job with total count
      await this.db
        .update(syncJobs)
        .set({ totalCommits: newSearchCommits.length })
        .where(eq(syncJobs.id, syncJobId));

      // Save commits
      let processed = 0;
      for (const searchCommit of newSearchCommits) {
        await this.saveSearchCommit(userId, searchCommit);
        processed++;

        if (processed % 10 === 0) {
          onProgress?.({
            status: "fetching",
            message: `커밋 저장 중... (${processed}/${newSearchCommits.length})`,
            totalCommits: newSearchCommits.length,
            processedCommits: processed,
          });
        }
      }

      // Mark initial sync as completed
      await this.db
        .update(users)
        .set({ initialSyncCompleted: true, lastSyncedAt: now(), updatedAt: now() })
        .where(eq(users.id, userId));

      // Complete sync job
      await this.completeSyncJob(syncJobId, newSearchCommits.length, processed);

      onProgress?.({
        status: "completed",
        message: `${newSearchCommits.length}개의 커밋을 동기화했습니다`,
        totalCommits: newSearchCommits.length,
        processedCommits: processed,
      });

      return { newCommits: newSearchCommits.length, syncJobId };
    } catch (error) {
      await this.failSyncJob(
        syncJobId,
        error instanceof Error ? error.message : "Unknown error"
      );

      onProgress?.({
        status: "failed",
        message: `동기화 실패: ${error instanceof Error ? error.message : "Unknown error"}`,
        totalCommits: 0,
        processedCommits: 0,
      });

      throw error;
    }
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
    // Create sync job
    const syncJobId = generateId();
    const timestamp = now();

    await this.db.insert(syncJobs).values({
      id: syncJobId,
      userId,
      syncType: "search",
      status: "fetching",
      triggerType,
      startedAt: timestamp,
      createdAt: timestamp,
    } satisfies NewSyncJob);

    onProgress?.({
      status: "fetching",
      message: "새로운 커밋을 검색하는 중...",
      totalCommits: 0,
      processedCommits: 0,
    });

    try {
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
        // Convert Date to ISO string if needed
        sinceDate = lastSyncedAt instanceof Date
          ? lastSyncedAt.toISOString()
          : String(lastSyncedAt);
      } else {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        sinceDate = sevenDaysAgo.toISOString();
      }

      console.log("[Sync] Searching commits since:", sinceDate, "for user:", username);

      // Fetch commits via Search API (paginated)
      const allSearchCommits: VCSSearchCommit[] = [];
      let page = 1;
      const perPage = 100;
      let hasMore = true;

      while (hasMore) {
        const searchCommits = await this.vcsAdapter.searchUserCommits(username, {
          since: sinceDate,
          perPage,
          page,
        });

        allSearchCommits.push(...searchCommits);

        onProgress?.({
          status: "fetching",
          message: `커밋 검색 중... (${allSearchCommits.length}개 발견)`,
          totalCommits: allSearchCommits.length,
          processedCommits: 0,
        });

        // GitHub Search API returns max 1000 results
        if (searchCommits.length < perPage || allSearchCommits.length >= 1000) {
          hasMore = false;
        } else {
          page++;
        }
      }

      console.log("[Sync] Found", allSearchCommits.length, "commits from Search API");

      // Filter out already existing commits
      const existingShas = await this.getExistingCommitShas(
        userId,
        allSearchCommits.map((c) => c.sha)
      );
      const newSearchCommits = allSearchCommits.filter(
        (c) => !existingShas.has(c.sha)
      );

      console.log("[Sync] After filtering:", newSearchCommits.length, "new commits (", existingShas.size, "already exist)");

      if (newSearchCommits.length === 0) {
        await this.completeSyncJob(syncJobId, 0, 0);

        // Update last synced time even if no new commits
        await this.db
          .update(users)
          .set({ lastSyncedAt: now(), updatedAt: now() })
          .where(eq(users.id, userId));

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

      // Save commits
      let processed = 0;
      for (const searchCommit of newSearchCommits) {
        await this.saveSearchCommit(userId, searchCommit);
        processed++;

        if (processed % 10 === 0) {
          onProgress?.({
            status: "fetching",
            message: `커밋 저장 중... (${processed}/${newSearchCommits.length})`,
            totalCommits: newSearchCommits.length,
            processedCommits: processed,
          });
        }
      }

      // Update last synced time
      await this.db
        .update(users)
        .set({ lastSyncedAt: now(), updatedAt: now() })
        .where(eq(users.id, userId));

      // Complete sync job
      await this.completeSyncJob(syncJobId, newSearchCommits.length, processed);

      onProgress?.({
        status: "completed",
        message: `${newSearchCommits.length}개의 새로운 커밋을 동기화했습니다`,
        totalCommits: newSearchCommits.length,
        processedCommits: processed,
      });

      return { newCommits: newSearchCommits.length, syncJobId };
    } catch (error) {
      await this.failSyncJob(
        syncJobId,
        error instanceof Error ? error.message : "Unknown error"
      );

      onProgress?.({
        status: "failed",
        message: `동기화 실패: ${error instanceof Error ? error.message : "Unknown error"}`,
        totalCommits: 0,
        processedCommits: 0,
      });

      throw error;
    }
  }

  private async getExistingCommitShas(
    userId: string,
    shas: string[]
  ): Promise<Set<string>> {
    if (shas.length === 0) return new Set();

    // Batch query to avoid too large IN clause
    // D1 has a limit of ~100 parameters per query
    const batchSize = 50;
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
    searchCommit: VCSSearchCommit
  ): Promise<string> {
    const commitId = generateId();
    const timestamp = now();

    // Save commit
    await this.db.insert(commits).values({
      id: commitId,
      userId,
      sha: searchCommit.sha,
      message: searchCommit.message,
      authorName: searchCommit.authorName,
      authorEmail: searchCommit.authorEmail,
      authorAvatarUrl: searchCommit.authorAvatarUrl,
      committedAt: new Date(searchCommit.committedAt),
      additions: searchCommit.additions ?? 0,
      deletions: searchCommit.deletions ?? 0,
      changedFilesCount: searchCommit.changedFilesCount ?? 0,
      isMergeCommit: searchCommit.isMergeCommit,
      parentShas: JSON.stringify(searchCommit.parentShas),
      repoFullName: searchCommit.repoFullName,
      repoId: searchCommit.repoId,
      repoIsPrivate: searchCommit.repoIsPrivate,
      createdAt: timestamp,
    } satisfies NewCommit);

    // Create summary record (pending status)
    await this.db.insert(commitSummaries).values({
      id: generateId(),
      commitId,
      status: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
    } satisfies NewCommitSummary);

    return commitId;
  }

  private async saveEventCommit(
    userId: string,
    commit: {
      sha: string;
      message: string;
      authorName: string;
      authorEmail: string | null;
      committedAt: string;
      repoFullName: string;
      repoId: number;
      repoIsPrivate: boolean;
    }
  ): Promise<string> {
    const commitId = generateId();
    const timestamp = now();

    // Save commit
    await this.db.insert(commits).values({
      id: commitId,
      userId,
      sha: commit.sha,
      message: commit.message,
      authorName: commit.authorName,
      authorEmail: commit.authorEmail,
      authorAvatarUrl: null, // Events API doesn't provide avatar URL
      committedAt: new Date(commit.committedAt),
      additions: 0, // Events API doesn't provide stats
      deletions: 0,
      changedFilesCount: 0,
      isMergeCommit: false, // Events API doesn't provide parent info
      parentShas: JSON.stringify([]),
      repoFullName: commit.repoFullName,
      repoId: commit.repoId,
      repoIsPrivate: commit.repoIsPrivate,
      createdAt: timestamp,
    } satisfies NewCommit);

    // Create summary record (pending status)
    await this.db.insert(commitSummaries).values({
      id: generateId(),
      commitId,
      status: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
    } satisfies NewCommitSummary);

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

  private async failSyncJob(
    syncJobId: string,
    errorMessage: string
  ): Promise<void> {
    await this.db
      .update(syncJobs)
      .set({
        status: "failed",
        errorMessage,
        completedAt: now(),
      })
      .where(eq(syncJobs.id, syncJobId));
  }

  /**
   * Get recent sync jobs for user
   */
  async getRecentSyncJobs(
    userId: string,
    limit: number = 10
  ): Promise<typeof syncJobs.$inferSelect[]> {
    return this.db
      .select()
      .from(syncJobs)
      .where(eq(syncJobs.userId, userId))
      .orderBy(desc(syncJobs.createdAt))
      .limit(limit);
  }

  /**
   * Check if initial sync is needed
   */
  async needsInitialSync(userId: string): Promise<boolean> {
    const user = await this.db
      .select({ initialSyncCompleted: users.initialSyncCompleted })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return !user[0]?.initialSyncCompleted;
  }
}

export function createSyncService(
  db: Database,
  accessToken: string
): SyncService {
  return new SyncService(db, accessToken);
}
