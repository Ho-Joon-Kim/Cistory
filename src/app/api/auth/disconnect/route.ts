import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function DELETE(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;
    const supabase = await createRouteHandlerClient();
    const db = getDb();

    // 사용자 데이터 삭제 (CASCADE로 관련 데이터도 삭제됨)
    await db.delete(users).where(eq(users.id, user.id));

    // 세션 종료
    await supabase.auth.signOut();

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
