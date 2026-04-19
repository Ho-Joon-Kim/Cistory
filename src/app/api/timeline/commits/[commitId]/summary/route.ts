import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { commitSummaries, commits, users } from "@/db/schema";
import { getAuthenticatedUser, getGitHubToken } from "@/lib/auth-helpers";
import { createSummaryService } from "@/modules/summary/service";

// 요약 재생성 요청
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ commitId: string }> }
) {
  try {
    const { commitId } = await params;
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;
    const db = getDb();

    const accessToken = await getGitHubToken(user.id, db, users);
    if (!accessToken) {
      return NextResponse.json({ error: "GitHub access token not found" }, { status: 400 });
    }

    // 커밋이 사용자 소유인지 확인
    const commitResult = await db
      .select({
        id: commits.id,
        summaryRetryCount: commitSummaries.retryCount,
      })
      .from(commits)
      .leftJoin(commitSummaries, eq(commits.id, commitSummaries.commitId))
      .where(and(eq(commits.id, commitId), eq(commits.userId, user.id)));

    if (commitResult.length === 0) {
      return NextResponse.json({ error: "Commit not found" }, { status: 404 });
    }

    const retryCount = commitResult[0].summaryRetryCount ?? 0;
    if (retryCount >= 3) {
      return NextResponse.json({ error: "Maximum retry count exceeded" }, { status: 429 });
    }

    // 요약 생성 서비스
    const summaryService = createSummaryService(db, process.env.ANTHROPIC_API_KEY!, accessToken);

    // 비동기로 요약 생성 시작 (응답은 즉시 반환)
    summaryService.regenerateSummary(commitId).catch((error) => {
      console.error("Summary regeneration failed:", error);
    });

    return NextResponse.json({ message: "요약 생성이 시작되었습니다" }, { status: 202 });
  } catch (error) {
    console.error("Regenerate summary error:", error);
    return NextResponse.json({ error: "Failed to regenerate summary" }, { status: 500 });
  }
}
