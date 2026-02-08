/**
 * WakaTime API Key Management
 *
 * POST /api/settings/wakatime-key - Verify and save API key
 * DELETE /api/settings/wakatime-key - Remove API key
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createWakaTimeAdapter } from "@/lib/adapters/wakatime/wakatime";
import { createWakaTimeSyncService } from "@/modules/wakatime/service";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const body = (await request.json()) as { apiKey?: string };
    const apiKey = body.apiKey?.trim();

    if (!apiKey) {
      return NextResponse.json(
        { error: "API 키를 입력해주세요" },
        { status: 400 }
      );
    }

    const adapter = createWakaTimeAdapter(apiKey);
    const isValid = await adapter.verifyApiKey();

    if (!isValid) {
      return NextResponse.json(
        { error: "유효하지 않은 API 키입니다" },
        { status: 400 }
      );
    }

    const wakatimeUser = await adapter.getCurrentUser();

    const db = getDb();
    await db
      .update(users)
      .set({ wakatimeApiKey: apiKey, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    // Fire-and-forget: initial sync for all commit dates
    const syncService = createWakaTimeSyncService(db, apiKey);
    syncService.syncAllCommitDates(user.id).catch((error) => {
      logger.error("[WakaTime] Background initial sync failed", {
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return NextResponse.json({
      success: true,
      wakatimeUser: {
        displayName: wakatimeUser.displayName,
        email: wakatimeUser.email,
      },
    });
  } catch (error) {
    console.error("Save WakaTime key error:", error);
    return NextResponse.json(
      { error: "WakaTime API 키 저장에 실패했습니다" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const db = getDb();
    await db
      .update(users)
      .set({
        wakatimeApiKey: null,
        wakatimeLastSyncedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Remove WakaTime key error:", error);
    return NextResponse.json(
      { error: "WakaTime API 키 삭제에 실패했습니다" },
      { status: 500 }
    );
  }
}
