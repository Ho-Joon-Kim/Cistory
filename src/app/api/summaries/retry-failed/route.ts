/**
 * POST /api/summaries/retry-failed — re-queue this user's failed AI summaries.
 *
 * A summary that failed MAX_RETRY_COUNT times stays `failed` and drops out of
 * the cron scan for good. This resets those rows (status → pending, retry
 * count and error cleared) so the next run tries them again, and starts one
 * bounded run in the background right away.
 */

import { and, eq, inArray } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { getDb } from "@/db";
import { commitSummaries, commits } from "@/db/schema";
import { checkSameOrigin } from "@/lib/api-auth";
import { withAuth } from "@/lib/api-handler";
import { getGitHubToken } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { createSummaryService } from "@/modules/summary/service";

const RUN_LIMIT = 100;

export const POST = withAuth(async ({ user, request }) => {
  if (!checkSameOrigin(request).ok) {
    return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  }
  const accessToken = await getGitHubToken(user.id);
  if (!accessToken) {
    return NextResponse.json(
      { error: "GitHub 로그인이 만료되었습니다. 다시 로그인해 주세요." },
      { status: 400 }
    );
  }
  const db = getDb();
  const requeued = await db
    .update(commitSummaries)
    .set({ status: "pending", retryCount: 0, errorMessage: null, updatedAt: new Date() })
    .where(
      and(
        eq(commitSummaries.status, "failed"),
        inArray(
          commitSummaries.commitId,
          db.select({ id: commits.id }).from(commits).where(eq(commits.userId, user.id))
        )
      )
    )
    .returning({ id: commitSummaries.id });

  if (requeued.length > 0) {
    const service = createSummaryService(db, process.env.ANTHROPIC_API_KEY!, accessToken, user.id);
    after(async () => {
      try {
        await service.processPendingSummaries(Math.min(requeued.length, RUN_LIMIT));
      } catch (error) {
        logger.error("[Summaries] Retry run failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }
  return NextResponse.json({ requeued: requeued.length }, { status: 202 });
});
