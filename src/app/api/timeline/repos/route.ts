import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers";
import { getDb } from "@/db";
import { commits } from "@/db/schema";
import { eq, sql, desc } from "drizzle-orm";

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
    console.error("Get repos error:", error);
    return NextResponse.json(
      { error: "Failed to fetch repositories" },
      { status: 500 }
    );
  }
}
