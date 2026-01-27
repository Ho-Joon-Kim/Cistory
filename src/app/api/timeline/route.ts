import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@/lib/supabase/server";
import { getDb, type Database } from "@/db";
import { commits, commitSummaries } from "@/db/schema";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient();
    const db = getDb();

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Query parameters
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get("page") ?? "1", 10);
    const perPage = Math.min(parseInt(searchParams.get("per_page") ?? "20", 10), 50);
    const repoFullName = searchParams.get("repo"); // Filter by repo full name
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    // Build conditions
    const conditions = [eq(commits.userId, user.id)];

    if (repoFullName) {
      conditions.push(eq(commits.repoFullName, repoFullName));
    }

    if (fromDate) {
      conditions.push(gte(commits.committedAt, new Date(fromDate)));
    }

    if (toDate) {
      conditions.push(lte(commits.committedAt, new Date(toDate)));
    }

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(commits)
      .where(and(...conditions));

    const total = countResult[0]?.count ?? 0;
    const totalPages = Math.ceil(total / perPage);
    const offset = (page - 1) * perPage;

    // Get commits with summaries
    const timelineCommits = await db
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

    // Format response
    const formattedCommits = timelineCommits.map((c) => ({
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
      summary: c.summaryId
        ? {
            status: c.summaryStatus,
            summary: c.summary,
          }
        : null,
    }));

    return NextResponse.json({
      commits: formattedCommits,
      pagination: {
        page,
        perPage,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error("Get timeline error:", error);
    return NextResponse.json(
      { error: "Failed to fetch timeline" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/timeline/repos - Get unique repositories from commits
 */
export async function getUniqueRepositories(userId: string, db: Database) {
  const repos = await db
    .selectDistinct({
      repoFullName: commits.repoFullName,
      repoId: commits.repoId,
      repoIsPrivate: commits.repoIsPrivate,
    })
    .from(commits)
    .where(eq(commits.userId, userId))
    .orderBy(commits.repoFullName);

  return repos.map((r) => ({
    fullName: r.repoFullName,
    id: r.repoId,
    isPrivate: r.repoIsPrivate,
  }));
}
