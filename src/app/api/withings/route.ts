import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { withAuth } from "@/lib/api-handler";
import { createWithingsSyncService } from "@/modules/withings/service";

/** DELETE /api/withings — disconnect the user's Withings account (hard-deletes the
 *  connection row so no decryptable live token survives; measurement history is kept). */
export const DELETE = withAuth(
  async ({ user }) => {
    await createWithingsSyncService(getDb()).disconnect(user.id);
    return NextResponse.json({ success: true });
  },
  { errorMessage: "연결 해제에 실패했습니다" }
);
