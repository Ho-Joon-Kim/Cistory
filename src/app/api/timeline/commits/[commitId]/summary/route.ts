import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { createDb } from "@/db";
import { commits, commitSummaries, users } from "@/db/schema";
import { createAuth } from "@/lib/auth";
import { createSummaryService } from "@/modules/summary/service";
import { eq, and } from "drizzle-orm";

export const runtime = "edge";

// 요약 재생성 요청
export async function POST(
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

    // Get user's GitHub access token from users table
    const userResult = await db
      .select({ githubAccessToken: users.githubAccessToken })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    const accessToken = userResult[0]?.githubAccessToken;

    if (!accessToken) {
      return NextResponse.json(
        { error: "GitHub access token not found" },
        { status: 400 }
      );
    }

    // 커밋이 사용자 소유인지 확인
    const commitResult = await db
      .select({
        id: commits.id,
        summaryRetryCount: commitSummaries.retryCount,
      })
      .from(commits)
      .leftJoin(commitSummaries, eq(commits.id, commitSummaries.commitId))
      .where(
        and(eq(commits.id, commitId), eq(commits.userId, session.user.id))
      );

    if (commitResult.length === 0) {
      return NextResponse.json({ error: "Commit not found" }, { status: 404 });
    }

    const retryCount = commitResult[0].summaryRetryCount ?? 0;
    if (retryCount >= 3) {
      return NextResponse.json(
        { error: "Maximum retry count exceeded" },
        { status: 429 }
      );
    }

    // 요약 생성 서비스
    const summaryService = createSummaryService(
      db,
      env.ANTHROPIC_API_KEY,
      accessToken
    );

    // 비동기로 요약 생성 시작 (응답은 즉시 반환)
    // Edge 환경에서는 waitUntil 사용
    const ctx = getRequestContext();
    ctx.ctx.waitUntil(
      summaryService.regenerateSummary(commitId).catch((error) => {
        console.error("Summary regeneration failed:", error);
      })
    );

    return NextResponse.json(
      { message: "요약 생성이 시작되었습니다" },
      { status: 202 }
    );
  } catch (error) {
    console.error("Regenerate summary error:", error);
    return NextResponse.json(
      { error: "Failed to regenerate summary" },
      { status: 500 }
    );
  }
}
