import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getAuthenticatedUser } from "@/lib/auth-helpers";

export async function DELETE(request: NextRequest) {
  try {
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
    console.error("Disconnect error:", error);
    return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 });
  }
}
