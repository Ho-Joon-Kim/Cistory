import { sql } from "drizzle-orm";
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
 * Get the GitHub access token for a user from Better Auth's \`account\` table.
 * Phase 9.2 removed the duplicate \`users.github_access_token\` column; this is
 * now the single source.
 */
export async function getGitHubToken(userId: string): Promise<string | null> {
  const db = getDb();
  const result = await db.execute<{ accessToken: string | null }>(
    sql`SELECT "accessToken" FROM "account" WHERE "userId" = ${userId} AND "providerId" = 'github' LIMIT 1`
  );
  return result.rows[0]?.accessToken ?? null;
}
