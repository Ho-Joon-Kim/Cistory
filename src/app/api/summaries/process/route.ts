/**
 * POST /api/summaries/process - Process pending summaries
 *
 * Manually trigger processing of pending summaries for the authenticated user
 */

import { eq, inArray, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { commitSummaries, commits } from "@/db/schema";
import { getAuthenticatedUser, getGitHubToken } from "@/lib/auth-helpers";
import { createSummaryService } from "@/modules/summary/service";

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;
    const db = getDb();

    // Get limit from request body (default 50)
    const body = await request.json().catch(() => ({}));
    const limit = Math.min(body.limit ?? 50, 100); // Max 100

    // Get user's GitHub token
    const accessToken = await getGitHubToken(user.id);
    if (!accessToken) {
      return NextResponse.json({ error: "GitHub access token not found" }, { status: 400 });
    }

    const summaryService = createSummaryService(db, process.env.ANTHROPIC_API_KEY!, accessToken);

    // Process in background
    (async () => {
      try {
        const processed = await summaryService.processPendingSummaries(limit);
        console.log(`[Summaries] Processed ${processed} pending summaries for user ${user.id}`);
      } catch (error) {
        console.error("[Summaries] Processing failed:", error);
      }
    })();

    return NextResponse.json(
      {
        message: `요약 생성이 시작되었습니다 (최대 ${limit}개)`,
        limit,
      },
      { status: 202 }
    );
  } catch (error) {
    console.error("Process summaries error:", error);
    return NextResponse.json({ error: "Failed to process summaries" }, { status: 500 });
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

    // Get user's commit IDs
    const userCommits = await db
      .select({ id: commits.id })
      .from(commits)
      .where(eq(commits.userId, user.id));

    const commitIds = userCommits.map((c) => c.id);

    if (commitIds.length === 0) {
      return NextResponse.json({
        total: 0,
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
      });
    }

    // Get summary stats
    const stats = await db
      .select({
        status: commitSummaries.status,
        count: sql<number>`count(*)`,
      })
      .from(commitSummaries)
      .where(inArray(commitSummaries.commitId, commitIds))
      .groupBy(commitSummaries.status);

    const result = {
      total: commitIds.length,
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
    console.error("Get summary stats error:", error);
    return NextResponse.json({ error: "Failed to get summary stats" }, { status: 500 });
  }
}
