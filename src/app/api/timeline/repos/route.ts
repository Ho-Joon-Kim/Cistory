import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { createDb } from "@/db";
import { commits } from "@/db/schema";
import { createAuth } from "@/lib/auth";
import { eq, sql, desc } from "drizzle-orm";

export const runtime = "edge";

/**
 * GET /api/timeline/repos - Get unique repositories from user's commits
 */
export async function GET(request: NextRequest) {
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

    // Get unique repositories with commit counts
    const repos = await db
      .select({
        repoFullName: commits.repoFullName,
        repoId: commits.repoId,
        repoIsPrivate: commits.repoIsPrivate,
        commitCount: sql<number>`count(*)`.as("commit_count"),
        lastCommitAt: sql<string>`max(${commits.committedAt})`.as("last_commit_at"),
      })
      .from(commits)
      .where(eq(commits.userId, session.user.id))
      .groupBy(commits.repoFullName, commits.repoId, commits.repoIsPrivate)
      .orderBy(desc(sql`last_commit_at`));

    return NextResponse.json({
      repositories: repos.map((r) => ({
        fullName: r.repoFullName,
        id: r.repoId,
        isPrivate: r.repoIsPrivate,
        commitCount: r.commitCount,
        lastCommitAt: r.lastCommitAt,
      })),
    });
  } catch (error) {
    console.error("Get repos error:", error);
    return NextResponse.json(
      { error: "Failed to fetch repositories" },
      { status: 500 }
    );
  }
}
