/**
 * DEPRECATED WakaTime API-key management.
 *
 * WakaTime now rejects API keys for reads ("API Keys are only for plugins, use
 * your personal oauth token"), so WakaTime is linked via OAuth instead
 * (/api/wakatime/authorize → /api/wakatime/callback, DELETE /api/wakatime).
 *
 * POST /api/settings/wakatime-key   - 410: API keys can no longer be linked
 * DELETE /api/settings/wakatime-key - clears a leftover legacy key
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const { error: authError } = await getAuthenticatedUser(request);
  if (authError) return authError;
  return NextResponse.json(
    {
      error:
        "WakaTime API 키 연동은 더 이상 지원되지 않습니다. 설정에서 WakaTime 계정을 연결해주세요",
      code: "WAKATIME_OAUTH_REQUIRED",
    },
    { status: 410 }
  );
}

export async function DELETE(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    await getDb()
      .update(users)
      .set({ wakatimeApiKey: null, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Remove WakaTime key error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "WakaTime API 키 삭제에 실패했습니다" }, { status: 500 });
  }
}
