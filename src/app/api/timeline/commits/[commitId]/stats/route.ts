import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { commits, users } from "@/db/schema";
import { createGitHubAdapter } from "@/lib/adapters/vcs/github";
import { getAuthenticatedUser, getGitHubToken } from "@/lib/auth-helpers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ commitId: string }> }
) {
  try {
    const { commitId } = await params;
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;
    const db = getDb();

    // 커밋 조회
    const commitResult = await db
      .select({
        id: commits.id,
        sha: commits.sha,
        repoFullName: commits.repoFullName,
        additions: commits.additions,
        deletions: commits.deletions,
        changedFilesCount: commits.changedFilesCount,
      })
      .from(commits)
      .where(and(eq(commits.id, commitId), eq(commits.userId, user.id)));

    if (commitResult.length === 0) {
      return NextResponse.json({ error: "Commit not found" }, { status: 404 });
    }

    const commit = commitResult[0];

    // 이미 stats가 있으면 바로 반환
    if (
      (commit.additions ?? 0) > 0 ||
      (commit.deletions ?? 0) > 0 ||
      (commit.changedFilesCount ?? 0) > 0
    ) {
      return NextResponse.json({
        additions: commit.additions ?? 0,
        deletions: commit.deletions ?? 0,
        changedFilesCount: commit.changedFilesCount ?? 0,
      });
    }

    // GitHub 토큰 가져오기
    const accessToken = await getGitHubToken(user.id);
    if (!accessToken) {
      return NextResponse.json({ error: "GitHub token not found" }, { status: 400 });
    }

    // GitHub API로 커밋 상세 정보 가져오기
    const github = createGitHubAdapter(accessToken);
    const [owner, repo] = commit.repoFullName.split("/");

    const commitDetail = await github.getCommitDetail(owner, repo, commit.sha);

    // DB 업데이트
    await db
      .update(commits)
      .set({
        additions: commitDetail.additions,
        deletions: commitDetail.deletions,
        changedFilesCount: commitDetail.changedFilesCount,
      })
      .where(eq(commits.id, commitId));

    return NextResponse.json({
      additions: commitDetail.additions,
      deletions: commitDetail.deletions,
      changedFilesCount: commitDetail.changedFilesCount,
    });
  } catch (error) {
    console.error("Get commit stats error:", error);
    return NextResponse.json({ error: "Failed to fetch commit stats" }, { status: 500 });
  }
}
