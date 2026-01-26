import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { eq } from "drizzle-orm";

export async function DELETE(request: NextRequest) {
  try {
    const db = getDb();
    const auth = getAuth();

    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 사용자 데이터 삭제 (CASCADE로 관련 데이터도 삭제됨)
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
