import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { createDb } from "@/db";
import { users } from "@/db/schema";
import { createAuth } from "@/lib/auth";
import { eq } from "drizzle-orm";

export const runtime = "edge";

export async function DELETE(request: NextRequest) {
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

    // 사용자 데이터 삭제 (CASCADE로 관련 데이터도 삭제됨)
    // repositories, commits, commit_summaries, sync_jobs 모두 자동 삭제
    await db.delete(users).where(eq(users.id, session.user.id));

    // 세션 종료
    await auth.api.signOut({ headers: request.headers });

    return NextResponse.json({
      success: true,
      message: "GitHub 연동이 해제되었고 모든 데이터가 삭제되었습니다",
    });
  } catch (error) {
    console.error("Disconnect error:", error);
    return NextResponse.json(
      { error: "Failed to disconnect" },
      { status: 500 }
    );
  }
}
