import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { checkSameOrigin } from "@/lib/api-auth";
import { auth } from "@/lib/auth";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";

export async function DELETE(request: NextRequest) {
  try {
    // CSRF hardening: this endpoint wipes the account and all data. SameSite
    // cookies help, but a cross-origin fetch from a compromised page could
    // still reach here in some browser configs. Reject mismatched Origin.
    const origin = checkSameOrigin(request);
    if (!origin.ok) {
      logger.warn("[auth/disconnect] rejected: cross-origin request", {
        reason: origin.reason,
      });
      return NextResponse.json({ error: "허용되지 않은 요청" }, { status: 403 });
    }

    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;
    const db = getDb();

    await db.delete(users).where(eq(users.id, user.id));

    await auth.api.signOut({
      headers: await headers(),
    });

    return NextResponse.json({
      success: true,
      message: "GitHub 연동이 해제되었고 모든 데이터가 삭제되었습니다",
    });
  } catch (error) {
    logger.error("Disconnect error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 });
  }
}
