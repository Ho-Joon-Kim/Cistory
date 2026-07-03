import { desc, eq, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { commits } from "@/db/schema";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";

/**
 * GET /api/timeline/repos - Get unique repositories from user's commits
 */
export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;
    const db = getDb();

    // Get unique repositories with commit counts
    const repos = await db
      .select({
        repoFullName: commits.repoFullName,
        repoId: commits.repoId,
        repoIsPrivate: commits.repoIsPrivate,
        commitCount: sql<number>`count(*)`.as("commit_count"),
        lastCommitAt: sql<string>`max(${commits.committedAt})`.as("last_commit_at"),
      })
      .from(commits)
      .where(eq(commits.userId, user.id))
      .groupBy(commits.repoFullName, commits.repoId, commits.repoIsPrivate)
      .orderBy(desc(sql`last_commit_at`));

    return NextResponse.json({
      repositories: repos.map((r) => ({
        fullName: r.repoFullName,
        id: r.repoId,
        isPrivate: r.repoIsPrivate,
        commitCount: r.commitCount,
        lastCommitAt: r.lastCommitAt,
      })),
    });
  } catch (error) {
    logger.error("Get repos error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "저장소 목록 조회에 실패했습니다" }, { status: 500 });
  }
}
