import { NextRequest, NextResponse } from "next/server";
import { createClient } from "./server";

/**
 * Get authenticated user from Supabase session
 * Returns user ID if authenticated, or NextResponse with 401 error
 */
export async function getAuthenticatedUser(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return {
      user: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { user, error: null };
}

/**
 * Get GitHub access token (hybrid approach)
 * 1. Try to get from session.provider_token (Supabase managed)
 * 2. Fallback to users.githubAccessToken (DB stored, for Cron)
 */
export async function getGitHubToken(userId: string, db: any, usersTable: any) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  // Try session first
  let token = session?.provider_token;

  // Fallback to DB
  if (!token) {
    const { eq } = await import("drizzle-orm");
    const userResult = await db
      .select({ githubAccessToken: usersTable.githubAccessToken })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    token = userResult[0]?.githubAccessToken;
  }

  return token;
}
