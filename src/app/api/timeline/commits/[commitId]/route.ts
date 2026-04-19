import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { commitSummaries, commits } from "@/db/schema";
import { getAuthenticatedUser } from "@/lib/auth-helpers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ commitId: string }> }
) {
  try {
    const { commitId } = await params;
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;
    const db = getDb();

    // 커밋 상세 조회 (사용자 소유 확인 포함)
    const result = await db
      .select({
        id: commits.id,
        sha: commits.sha,
        message: commits.message,
        authorName: commits.authorName,
        authorEmail: commits.authorEmail,
        authorAvatarUrl: commits.authorAvatarUrl,
        committedAt: commits.committedAt,
        additions: commits.additions,
        deletions: commits.deletions,
        changedFilesCount: commits.changedFilesCount,
        isMergeCommit: commits.isMergeCommit,
        parentShas: commits.parentShas,
        repoFullName: commits.repoFullName,
        repoId: commits.repoId,
        repoIsPrivate: commits.repoIsPrivate,
        summaryId: commitSummaries.id,
        summaryStatus: commitSummaries.status,
        summary: commitSummaries.summary,
        retryCount: commitSummaries.retryCount,
      })
      .from(commits)
      .leftJoin(commitSummaries, eq(commits.id, commitSummaries.commitId))
      .where(and(eq(commits.id, commitId), eq(commits.userId, user.id)));

    if (result.length === 0) {
      return NextResponse.json({ error: "Commit not found" }, { status: 404 });
    }

    const commit = result[0];

    return NextResponse.json({
      id: commit.id,
      sha: commit.sha,
      message: commit.message,
      authorName: commit.authorName,
      authorEmail: commit.authorEmail,
      authorAvatarUrl: commit.authorAvatarUrl,
      committedAt: commit.committedAt,
      additions: commit.additions,
      deletions: commit.deletions,
      changedFilesCount: commit.changedFilesCount,
      isMergeCommit: commit.isMergeCommit,
      parentShas: commit.parentShas ? JSON.parse(commit.parentShas) : [],
      repository: {
        fullName: commit.repoFullName,
        id: commit.repoId,
        isPrivate: commit.repoIsPrivate,
      },
      summary: commit.summaryId
        ? {
            status: commit.summaryStatus,
            summary: commit.summary,
            retryCount: commit.retryCount,
          }
        : null,
    });
  } catch (error) {
    console.error("Get commit detail error:", error);
    return NextResponse.json({ error: "Failed to fetch commit detail" }, { status: 500 });
  }
}
