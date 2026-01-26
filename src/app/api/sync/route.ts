/**
 * Sync API Route
 *
 * POST /api/sync - Start user commit sync
 */

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { createDb } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createAuth } from "@/lib/auth";
import { createSyncService } from "@/modules/sync/service";
import { createSummaryService } from "@/modules/summary/service";

export const runtime = "edge";

export async function POST(request: NextRequest) {
  try {
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

    // Get user's GitHub login and access token from users table
    const userResult = await db
      .select({
        githubLogin: users.githubLogin,
        githubAccessToken: users.githubAccessToken,
        initialSyncCompleted: users.initialSyncCompleted,
      })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    if (!userResult[0]) {
      return NextResponse.json(
        { error: "User not found. Please re-login." },
        { status: 404 }
      );
    }

    const { githubLogin, githubAccessToken, initialSyncCompleted } = userResult[0];

    if (!githubAccessToken) {
      return NextResponse.json(
        { error: "GitHub access token not found" },
        { status: 400 }
      );
    }

    const accessToken = githubAccessToken;

    const syncService = createSyncService(db, accessToken);
    const summaryService = createSummaryService(
      db,
      env.ANTHROPIC_API_KEY,
      accessToken
    );

    // Execute sync in background (respond immediately)
    const ctx = getRequestContext();

    ctx.ctx.waitUntil(
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
      })()
    );

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
