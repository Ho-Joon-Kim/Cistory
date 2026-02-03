/**
 * Ensure User API Route
 *
 * POST /api/auth/ensure-user - Ensures the user record exists in the users table
 *
 * This is called after OAuth callback to create/update the app-specific user record
 */

import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers";
import { getDb, users } from "@/db";
import { eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;
    const db = getDb();

    const userId = user.id;

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

    // Get GitHub access token from session
    const supabase = await createRouteHandlerClient();
    const { data: { session } } = await supabase.auth.getSession();
    const githubToken = session?.provider_token;

    if (!githubToken) {
      return NextResponse.json(
        { error: "GitHub access token not found" },
        { status: 400 }
      );
    }

    // Fetch GitHub user info
    const githubUserResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${githubToken}`,
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
      id: number;
      login: string;
      avatar_url: string;
    };

    const timestamp = new Date();

    // Create new user record
    await db.insert(users).values({
      id: userId,
      githubId: githubUser.id,
      githubLogin: githubUser.login,
      githubAvatarUrl: githubUser.avatar_url,
      githubAccessToken: githubToken, // Store for Cron jobs
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
