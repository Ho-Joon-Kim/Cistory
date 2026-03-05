import { NextRequest, NextResponse } from "next/server";
import { auth } from "./auth";
import { headers } from "next/headers";

/**
 * Get authenticated user from Better Auth session
 * Returns user if authenticated, or NextResponse with 401 error
 */
export async function getAuthenticatedUser(_request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return {
      user: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { user: session.user, error: null };
}

/**
 * Get GitHub access token from DB (for API routes and Cron)
 */
export async function getGitHubToken(userId: string, db: any, usersTable: any) {
  const { eq } = await import("drizzle-orm");
  const userResult = await db
    .select({ githubAccessToken: usersTable.githubAccessToken })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  return userResult[0]?.githubAccessToken;
}
