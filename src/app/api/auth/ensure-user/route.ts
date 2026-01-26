/**
 * Ensure User API Route
 *
 * POST /api/auth/ensure-user - Ensures the user record exists in the users table
 *
 * This is called after OAuth callback to create/update the app-specific user record
 */

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { createDb } from "@/db";
import { account, users } from "@/db/schema";
import { createAuth } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { now } from "@/lib/utils";

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

    const userId = session.user.id;

    // Check if user already exists in our users table
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (existingUser.length > 0) {
      // User already exists, just return success
      return NextResponse.json({
        message: "User already exists",
        initialSyncCompleted: existingUser[0].initialSyncCompleted,
      });
    }

    // Get the account info (contains access token)
    const accountResult = await db
      .select()
      .from(account)
      .where(eq(account.userId, userId))
      .limit(1);

    if (!accountResult[0]) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 404 }
      );
    }

    const accountRecord = accountResult[0];
    const accessToken = accountRecord.accessToken;
    const githubId = parseInt(accountRecord.accountId, 10);

    if (!accessToken) {
      return NextResponse.json(
        { error: "GitHub access token not found" },
        { status: 400 }
      );
    }

    // Fetch GitHub user info
    const githubUserResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
      },
    });

    if (!githubUserResponse.ok) {
      return NextResponse.json(
        { error: "Failed to fetch GitHub user info" },
        { status: 500 }
      );
    }

    const githubUser = (await githubUserResponse.json()) as {
      login: string;
      avatar_url: string;
    };

    const timestamp = now();

    // Create new user record
    await db.insert(users).values({
      id: userId,
      githubId,
      githubLogin: githubUser.login,
      githubAvatarUrl: githubUser.avatar_url,
      githubAccessToken: accessToken,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return NextResponse.json({
      message: "User created successfully",
      initialSyncCompleted: false,
    });
  } catch (error) {
    console.error("Ensure user error:", error);
    return NextResponse.json(
      { error: "Failed to ensure user" },
      { status: 500 }
    );
  }
}
