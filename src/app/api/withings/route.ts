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
  { errorMessage: "연결을 해제하지 못했습니다. 잠시 후 다시 시도해 주세요." }
);
