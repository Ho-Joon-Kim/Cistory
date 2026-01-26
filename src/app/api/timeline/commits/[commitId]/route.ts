import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { createDb } from "@/db";
import { commits, commitSummaries } from "@/db/schema";
import { createAuth } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

export const runtime = "edge";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ commitId: string }> }
) {
  try {
    const { commitId } = await params;
    const { env } = getRequestContext();
    const db = createDb(env.DB);

    const auth = createAuth({
      DB: env.DB,
      GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
      GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: env.BETTER_AUTH_URL,
    });

    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
        technicalSummary: commitSummaries.technicalSummary,
        nonTechnicalSummary: commitSummaries.nonTechnicalSummary,
        retryCount: commitSummaries.retryCount,
      })
      .from(commits)
      .leftJoin(commitSummaries, eq(commits.id, commitSummaries.commitId))
      .where(
        and(
          eq(commits.id, commitId),
          eq(commits.userId, session.user.id)
        )
      );

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
            technicalSummary: commit.technicalSummary,
            nonTechnicalSummary: commit.nonTechnicalSummary,
            retryCount: commit.retryCount,
          }
        : null,
    });
  } catch (error) {
    console.error("Get commit detail error:", error);
    return NextResponse.json(
      { error: "Failed to fetch commit detail" },
      { status: 500 }
    );
  }
}
