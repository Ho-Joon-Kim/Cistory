import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers";
import { getDb } from "@/db";
import { commits, commitSummaries } from "@/db/schema";
import { eq, and, desc, gt, gte, lte, sql, inArray } from "drizzle-orm";

/** Parse date string to local-timezone Date. Handles both "YYYY-MM-DD" and full ISO strings. */
function parseDateLocal(str: string): Date | null {
  // YYYY-MM-DD → local midnight
  const dateOnly = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  // Full ISO or other format
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;
    const db = getDb();

    // Query parameters
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get("page") ?? "1", 10);
    const perPage = Math.min(parseInt(searchParams.get("per_page") ?? "20", 10), 50);
    const reposParam = searchParams.get("repos"); // Filter by multiple repos (comma-separated)
    const afterDate = searchParams.get("after");
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    // Build conditions
    const conditions = [eq(commits.userId, user.id)];

    if (reposParam) {
      const repoNames = reposParam.split(",").filter(Boolean);
      if (repoNames.length > 0) {
        conditions.push(inArray(commits.repoFullName, repoNames));
      }
    }

    if (afterDate) {
      const parsed = parseDateLocal(afterDate);
      if (!parsed) {
        return NextResponse.json({ error: "Invalid 'after' date format" }, { status: 400 });
      }
      conditions.push(gt(commits.committedAt, parsed));
    }

    if (fromDate) {
      const parsed = parseDateLocal(fromDate);
      if (!parsed) {
        return NextResponse.json({ error: "Invalid 'from' date format" }, { status: 400 });
      }
      conditions.push(gte(commits.committedAt, parsed));
    }

    if (toDate) {
      const parsed = parseDateLocal(toDate);
      if (!parsed) {
        return NextResponse.json({ error: "Invalid 'to' date format" }, { status: 400 });
      }
      // Include the entire "to" day
      conditions.push(lte(commits.committedAt, parsed));
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
