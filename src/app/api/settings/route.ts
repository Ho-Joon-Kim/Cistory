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
import { healthConnections, users, withingsConnections } from "@/db/schema";
import { withAuth, withValidation } from "@/lib/api-handler";
import { DEFAULT_USER_SETTINGS, type UserSettings } from "@/modules/settings/types";

const SettingsUpdateBody = z
  .object({
    theme: z.enum(["light", "dark", "system"]).optional(),
    syncIntervalHours: z.number().int().min(1).max(24).optional(),
    tossMyName: z.string().nullable().optional(),
  })
  .strict();

/**
 * Read the user's full settings payload. Both GET and PUT respond with this
 * complete shape — the client hook replaces its entire state with the
 * response, so a partial payload would wipe whatever fields it omits.
 */
async function readUserSettings(userId: string): Promise<UserSettings> {
  const db = getDb();
  // All selects key only on userId and are independent — run them together.
  const [userResult, withingsResult, healthResult] = await Promise.all([
    db
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
      .where(eq(users.id, userId)),
    db
      .select({
        withingsUserId: withingsConnections.withingsUserId,
        status: withingsConnections.status,
        lastSyncedAt: withingsConnections.lastSyncedAt,
      })
      .from(withingsConnections)
      .where(eq(withingsConnections.userId, userId)),
    db
      .select({
        status: healthConnections.status,
        lastSyncedAt: healthConnections.lastSyncedAt,
      })
      .from(healthConnections)
      .where(eq(healthConnections.userId, userId)),
  ]);

  if (userResult.length === 0) {
    return DEFAULT_USER_SETTINGS;
  }

  const withings = withingsResult[0];
  const health = healthResult[0];
  const row = userResult[0];
  return {
    theme: (row.theme as UserSettings["theme"]) || DEFAULT_USER_SETTINGS.theme,
    syncIntervalHours: row.syncIntervalHours ?? DEFAULT_USER_SETTINGS.syncIntervalHours,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    hasOwnTracksKey: !!row.ownTracksApiKey,
    hasTossKey: !!row.tossNotificationApiKey,
    tossMyName: row.tossMyName ?? null,
    hasWakaTimeKey: !!row.wakatimeApiKey,
    lastLat: row.lastLat ?? null,
    lastLon: row.lastLon ?? null,
    hasWithingsConnection: !!withings,
    withingsUserId: withings?.withingsUserId ?? null,
    withingsLastSyncedAt: withings?.lastSyncedAt?.toISOString() ?? null,
    withingsNeedsReauth: withings?.status === "needs_reauth",
    hasHealthConnection: !!health,
    healthLastSyncedAt: health?.lastSyncedAt?.toISOString() ?? null,
    healthNeedsReauth: health?.status === "needs_reauth",
  };
}

export const GET = withAuth(
  async ({ user }) => {
    return NextResponse.json(await readUserSettings(user.id));
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

    return NextResponse.json(await readUserSettings(user.id));
  },
  { errorMessage: "Failed to update settings" }
);
