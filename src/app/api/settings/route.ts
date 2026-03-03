/**
 * Settings API Route
 *
 * GET /api/settings - 사용자 설정 조회
 * PUT /api/settings - 사용자 설정 업데이트
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

interface UserSettings {
  theme: "light" | "dark" | "system";
  syncIntervalHours: number;
  lastSyncedAt: string | null;
}

const DEFAULT_SETTINGS: UserSettings = {
  theme: "system",
  syncIntervalHours: 1,
  lastSyncedAt: null,
};

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;
    const db = getDb();

    const userResult = await db
      .select({
        theme: users.theme,
        syncIntervalHours: users.syncIntervalHours,
        lastSyncedAt: users.lastSyncedAt,
        ownTracksApiKey: users.ownTracksApiKey,
        tossNotificationApiKey: users.tossNotificationApiKey,
        wakatimeApiKey: users.wakatimeApiKey,
        lastLat: users.lastLat,
        lastLon: users.lastLon,
      })
      .from(users)
      .where(eq(users.id, user.id));

    if (userResult.length === 0) {
      return NextResponse.json({ ...DEFAULT_SETTINGS, hasOwnTracksKey: false, hasTossKey: false, hasWakaTimeKey: false, lastLat: null, lastLon: null });
    }

    const userSettings = userResult[0];

    return NextResponse.json({
      theme: (userSettings.theme as UserSettings["theme"]) || DEFAULT_SETTINGS.theme,
      syncIntervalHours: userSettings.syncIntervalHours ?? DEFAULT_SETTINGS.syncIntervalHours,
      lastSyncedAt: userSettings.lastSyncedAt?.toISOString() ?? null,
      hasOwnTracksKey: !!userSettings.ownTracksApiKey,
      hasTossKey: !!userSettings.tossNotificationApiKey,
      hasWakaTimeKey: !!userSettings.wakatimeApiKey,
      lastLat: userSettings.lastLat ?? null,
      lastLon: userSettings.lastLon ?? null,
    });
  } catch (error) {
    console.error("Get settings error:", error);
    return NextResponse.json(
      { error: "Failed to get settings" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;
    const db = getDb();

    const body = (await request.json()) as Partial<UserSettings>;
    const updates: Partial<{ theme: string; syncIntervalHours: number; updatedAt: Date }> = {
      updatedAt: new Date(),
    };

    // 유효성 검사
    if (body.theme && ["light", "dark", "system"].includes(body.theme)) {
      updates.theme = body.theme;
    }

    if (
      typeof body.syncIntervalHours === "number" &&
      body.syncIntervalHours >= 1 &&
      body.syncIntervalHours <= 24
    ) {
      updates.syncIntervalHours = body.syncIntervalHours;
    }

    await db
      .update(users)
      .set(updates)
      .where(eq(users.id, user.id));

    // 업데이트된 설정 반환
    const updatedUserResult = await db
      .select({
        theme: users.theme,
        syncIntervalHours: users.syncIntervalHours,
        lastSyncedAt: users.lastSyncedAt,
      })
      .from(users)
      .where(eq(users.id, user.id));

    const updatedSettings = updatedUserResult[0];

    return NextResponse.json({
      theme: (updatedSettings?.theme as UserSettings["theme"]) || DEFAULT_SETTINGS.theme,
      syncIntervalHours: updatedSettings?.syncIntervalHours ?? DEFAULT_SETTINGS.syncIntervalHours,
      lastSyncedAt: updatedSettings?.lastSyncedAt?.toISOString() ?? null,
    });
  } catch (error) {
    console.error("Update settings error:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
