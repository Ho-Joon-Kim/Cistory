import { eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { auth } from "./auth";

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
 * Get the GitHub access token for a user.
 *
 * Reads from Better Auth's \`account\` table (the authoritative source Better
 * Auth refreshes on each sign-in) rather than the duplicate copy previously
 * kept in \`users.githubAccessToken\`. That duplicate will be dropped in a
 * follow-up migration once this is confirmed working; for now we prefer
 * \`account\` and fall back to \`users\` so a missed refresh doesn't brick sync.
 */
export async function getGitHubToken(userId: string): Promise<string | null> {
  const db = getDb();

  // Primary: Better Auth account row
  const accountResult = await db.execute<{ accessToken: string | null }>(
    sql`SELECT "accessToken" FROM "account" WHERE "userId" = ${userId} AND "providerId" = 'github' LIMIT 1`
  );
  const fromAccount = accountResult.rows[0]?.accessToken;
  if (fromAccount) return fromAccount;

  // Fallback: legacy users.github_access_token (removed in Phase 9.2)
  const fromUsers = await db.execute<{ github_access_token: string | null }>(
    sql`SELECT github_access_token FROM users WHERE id = ${userId} LIMIT 1`
  );
  return fromUsers.rows[0]?.github_access_token ?? null;
}

/**
 * Legacy signature shim (userId, db, usersTable) for call sites that haven't
 * migrated yet. Delegates to the new single-arg form. Remove once all callers
 * use \`getGitHubToken(userId)\`.
 */
// biome-ignore lint/suspicious/noExplicitAny: transitional compatibility shim
export async function getGitHubTokenLegacy(userId: string, _db: any, _usersTable: any) {
  return getGitHubToken(userId);
}

// Export `eq` for callers that still import it from here (drop after all
// routes migrate). TS tree-shakes unused re-exports.
void eq;
