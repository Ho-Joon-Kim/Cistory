/**
 * Sync API Route
 *
 * POST /api/sync - Start user commit sync
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createSyncService } from "@/modules/sync/service";
import { createSummaryService } from "@/modules/summary/service";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const db = getDb();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user's GitHub login and access token from users table
    const userResult = await db
      .select({
        githubLogin: users.githubLogin,
        githubAccessToken: users.githubAccessToken,
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

    const { githubLogin, githubAccessToken, initialSyncCompleted } = userResult[0];

    // Try to get token from session first (hybrid approach)
    const { data: { session } } = await supabase.auth.getSession();
    const accessToken = session?.provider_token || githubAccessToken;

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
      try {
        // If initial sync not completed, do initial sync with Search API
        if (!initialSyncCompleted) {
          await syncService.initialSync(session.user.id, githubLogin);
        } else {
          // Otherwise do regular sync with Events API
          await syncService.syncUserCommits(session.user.id, githubLogin, "manual");
        }

        // Process pending summaries after sync
        await summaryService.processPendingSummaries(10);
      } catch (error) {
        console.error("Sync failed:", error);
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
    console.error("Sync trigger error:", error);
    return NextResponse.json(
      { error: "Failed to trigger sync" },
      { status: 500 }
    );
  }
}
