import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { commits } from "@/db/schema";
import { getAuthenticatedUser, getGitHubToken } from "@/lib/auth-helpers";
import { createSummaryService } from "@/modules/summary/service";
import { logger } from "@/lib/logger";

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

    const accessToken = await getGitHubToken(user.id);
    if (!accessToken) {
      return NextResponse.json(
        { error: "GitHub 액세스 토큰이 없습니다. 다시 로그인해주세요" },
        { status: 400 }
      );
    }

    // Ownership check only — retry-count gating moved into
    // SummaryService.regenerateSummary, which resets the counter for
    // user-initiated retries (see Phase 3 C5).
    const [commitResult] = await db
      .select({ id: commits.id })
      .from(commits)
      .where(and(eq(commits.id, commitId), eq(commits.userId, user.id)))
      .limit(1);

    if (!commitResult) {
      return NextResponse.json({ error: "커밋을 찾을 수 없습니다" }, { status: 404 });
    }

    const summaryService = createSummaryService(db, process.env.ANTHROPIC_API_KEY!, accessToken);

    // 비동기로 요약 생성 시작 (응답은 즉시 반환)
    summaryService.regenerateSummary(commitId).catch((error) => {
      logger.error("Summary regeneration failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return NextResponse.json({ message: "요약 생성이 시작되었습니다" }, { status: 202 });
  } catch (error) {
    logger.error("Regenerate summary error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "요약 재생성에 실패했습니다" }, { status: 500 });
  }
}
