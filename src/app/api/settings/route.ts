/**
 * Settings API Route
 *
 * GET /api/settings - 사용자 설정 조회
 * PUT /api/settings - 사용자 설정 업데이트
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { withAuth, withValidation } from "@/lib/api-handler";

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

const SettingsUpdateBody = z
  .object({
    theme: z.enum(["light", "dark", "system"]).optional(),
    syncIntervalHours: z.number().int().min(1).max(24).optional(),
    tossMyName: z.string().nullable().optional(),
  })
  .strict();

export const GET = withAuth(
  async ({ user }) => {
    const db = getDb();
    const userResult = await db
      .select({
        theme: users.theme,
        syncIntervalHours: users.syncIntervalHours,
        lastSyncedAt: users.lastSyncedAt,
        ownTracksApiKey: users.ownTracksApiKey,
        tossNotificationApiKey: users.tossNotificationApiKey,
        tossMyName: users.tossMyName,
        wakatimeApiKey: users.wakatimeApiKey,
        lastLat: users.lastLat,
        lastLon: users.lastLon,
      })
      .from(users)
      .where(eq(users.id, user.id));

    if (userResult.length === 0) {
      return NextResponse.json({
        ...DEFAULT_SETTINGS,
        hasOwnTracksKey: false,
        hasTossKey: false,
        tossMyName: null,
        hasWakaTimeKey: false,
        lastLat: null,
        lastLon: null,
      });
    }

    const userSettings = userResult[0];
    return NextResponse.json({
      theme: (userSettings.theme as UserSettings["theme"]) || DEFAULT_SETTINGS.theme,
      syncIntervalHours: userSettings.syncIntervalHours ?? DEFAULT_SETTINGS.syncIntervalHours,
      lastSyncedAt: userSettings.lastSyncedAt?.toISOString() ?? null,
      hasOwnTracksKey: !!userSettings.ownTracksApiKey,
      hasTossKey: !!userSettings.tossNotificationApiKey,
      tossMyName: userSettings.tossMyName ?? null,
      hasWakaTimeKey: !!userSettings.wakatimeApiKey,
      lastLat: userSettings.lastLat ?? null,
      lastLon: userSettings.lastLon ?? null,
    });
  },
  { errorMessage: "Failed to get settings" }
);

export const PUT = withValidation(
  SettingsUpdateBody,
  async ({ user, body }) => {
    const db = getDb();
    const updates: Partial<{
      theme: string;
      syncIntervalHours: number;
      tossMyName: string | null;
      updatedAt: Date;
    }> = { updatedAt: new Date() };

    if (body.theme) updates.theme = body.theme;
    if (typeof body.syncIntervalHours === "number") {
      updates.syncIntervalHours = body.syncIntervalHours;
    }
    if ("tossMyName" in body) {
      const name = body.tossMyName;
      updates.tossMyName = typeof name === "string" && name.trim() ? name.trim() : null;
    }

    await db.update(users).set(updates).where(eq(users.id, user.id));

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
  },
  { errorMessage: "Failed to update settings" }
);
