import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, users } from "@/db";
import { withAuth } from "@/lib/api-handler";
import { createWakaTimeConnectionService } from "@/modules/wakatime/connection";

/** DELETE /api/wakatime — disconnect WakaTime. Best-effort revokes the OAuth
 *  tokens, hard-deletes the connection row, and clears the deprecated API key
 *  plus the sync watermark (so a reconnect re-syncs the gap). Coding history is kept. */
export const DELETE = withAuth(
  async ({ user }) => {
    const db = getDb();
    await createWakaTimeConnectionService(db).disconnect(user.id);
    await db
      .update(users)
      .set({ wakatimeApiKey: null, wakatimeLastSyncedAt: null, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    return NextResponse.json({ success: true });
  },
  { errorMessage: "연결 해제에 실패했습니다" }
);
