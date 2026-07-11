import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { withAuth } from "@/lib/api-handler";
import { createHealthSyncService } from "@/modules/health/service";

/** DELETE /api/fitbit — disconnect the user's Google Health (Fitbit) account.
 *  Best-effort revoke, then hard-delete the connection row (regardless of revoke
 *  outcome) so no decryptable live token survives; sample/summary history is kept. */
export const DELETE = withAuth(
  async ({ user }) => {
    await createHealthSyncService(getDb()).disconnect(user.id);
    return NextResponse.json({ success: true });
  },
  { errorMessage: "연결 해제에 실패했습니다" }
);
