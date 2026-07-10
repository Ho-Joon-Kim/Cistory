import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { createWithingsSyncService } from "@/modules/withings/service";

/** DELETE /api/withings — disconnect the user's Withings account (hard-deletes the
 *  connection row so no decryptable live token survives; measurement history is kept). */
export async function DELETE(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error) return error;

  try {
    await createWithingsSyncService(getDb()).disconnect(user.id);
    return NextResponse.json({ success: true });
  } catch (e) {
    logger.error("[Withings] disconnect failed", { userId: user.id, error: String(e) });
    return NextResponse.json({ error: "연결 해제에 실패했습니다" }, { status: 500 });
  }
}
