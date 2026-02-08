/**
 * Sync API Route
 *
 * POST /api/sync - Start user commit sync
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getGitHubToken } from "@/lib/supabase/auth-helpers";
import { getDb } from "@/db";
import { users, syncJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createSyncService } from "@/modules/sync/service";
import { createSummaryService } from "@/modules/summary/service";
import { now } from "@/lib/utils";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;
    const db = getDb();

    // Get user's GitHub login and initial sync status from users table
    const userResult = await db
      .select({
        githubLogin: users.githubLogin,
        initialSyncCompleted: users.initialSyncCompleted,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    if (!userResult[0]) {
      return NextResponse.json(
        { error: "User not found. Please re-login." },
        { status: 404 }
      );
    }

    const { githubLogin, initialSyncCompleted } = userResult[0];

    const accessToken = await getGitHubToken(user.id, db, users);
    if (!accessToken) {
      return NextResponse.json(
        { error: "GitHub access token not found" },
        { status: 400 }
      );
    }

    const syncService = createSyncService(db, accessToken);
    const summaryService = createSummaryService(
      db,
      process.env.ANTHROPIC_API_KEY!,
      accessToken
    );

    // Execute sync in background (respond immediately)
    (async () => {
      let syncJobId: string | null = null;

      try {
        // If initial sync not completed, do initial sync with Search API
        if (!initialSyncCompleted) {
          const result = await syncService.initialSync(user.id, githubLogin);
          syncJobId = result.syncJobId;
        } else {
          // Otherwise do regular sync with Events API
          const result = await syncService.syncUserCommits(user.id, githubLogin, "manual");
          syncJobId = result.syncJobId;
        }

        // Update sync job status to 'summarizing' before processing summaries
        if (syncJobId) {
          await db
            .update(syncJobs)
            .set({ status: "summarizing" })
            .where(eq(syncJobs.id, syncJobId));
        }

        // Process pending summaries after sync (up to 50)
        await summaryService.processPendingSummaries(50);

        // Update sync job status to 'completed' after summaries are done
        if (syncJobId) {
          await db
            .update(syncJobs)
            .set({ status: "completed", completedAt: now() })
            .where(eq(syncJobs.id, syncJobId));
        }
      } catch (error) {
        logger.error("Sync failed", {
          userId: user.id,
          syncJobId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return NextResponse.json(
      {
        message: "동기화가 시작되었습니다",
        type: initialSyncCompleted ? "events" : "initial",
      },
      { status: 202 }
    );
  } catch (error) {
    logger.error("Sync trigger error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to trigger sync" },
      { status: 500 }
    );
  }
}
