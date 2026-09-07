/**
 * POST /api/summaries/process - Process pending summaries
 *
 * Manually trigger processing of pending summaries for the authenticated user
 */

import { eq, sql } from "drizzle-orm";
import { after, type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { commitSummaries, commits } from "@/db/schema";
import { getAuthenticatedUser, getGitHubToken } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { createSummaryService } from "@/modules/summary/service";

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;
    const db = getDb();

    // Get limit from request body (default 50)
    const body = await request.json().catch(() => ({}));
    const limit = body.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return NextResponse.json({ error: "limit은 1~100 사이 정수여야 합니다" }, { status: 400 });
    }

    // Get user's GitHub token
    const accessToken = await getGitHubToken(user.id);
    if (!accessToken) {
      return NextResponse.json(
        { error: "GitHub 액세스 토큰이 없습니다. 다시 로그인해주세요" },
        { status: 400 }
      );
    }

    const summaryService = createSummaryService(
      db,
      process.env.ANTHROPIC_API_KEY!,
      accessToken,
      user.id
    );

    // Process in background
    after(async () => {
      try {
        const processed = await summaryService.processPendingSummaries(limit);
        logger.info(`[Summaries] Processed ${processed} pending summaries`, { userId: user.id });
      } catch (error) {
        logger.error("[Summaries] Processing failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return NextResponse.json(
      {
        message: `요약 생성이 시작되었습니다 (최대 ${limit}개)`,
        limit,
      },
      { status: 202 }
    );
  } catch (error) {
    logger.error("Process summaries error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "요약 생성에 실패했습니다" }, { status: 500 });
  }
}

/**
 * GET /api/summaries/process - Get pending summary stats
 */
export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;
    const db = getDb();

    // Aggregate in PostgreSQL instead of materializing every commit ID and
    // sending a potentially unbounded IN list back to the database. A left
    // join retains the historical total (all commits, even without a summary).
    const stats = await db
      .select({
        status: commitSummaries.status,
        count: sql<number>`count(*)`,
      })
      .from(commits)
      .leftJoin(commitSummaries, eq(commitSummaries.commitId, commits.id))
      .where(eq(commits.userId, user.id))
      .groupBy(commitSummaries.status);

    const result = {
      total: stats.reduce((total, stat) => total + Number(stat.count), 0),
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    };

    for (const stat of stats) {
      if (stat.status === "pending") result.pending = Number(stat.count);
      else if (stat.status === "processing") result.processing = Number(stat.count);
      else if (stat.status === "completed") result.completed = Number(stat.count);
      else if (stat.status === "failed") result.failed = Number(stat.count);
    }

    return NextResponse.json(result);
  } catch (error) {
    logger.error("Get summary stats error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "요약 통계 조회에 실패했습니다" }, { status: 500 });
  }
}
