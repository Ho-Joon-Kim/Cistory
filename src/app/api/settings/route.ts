/**
 * Settings API Route
 *
 * GET /api/settings - 사용자 설정 조회
 * PUT /api/settings - 사용자 설정 업데이트
 */

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { createDb } from "@/db";
import { createAuth } from "@/lib/auth";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "edge";

interface UserSettings {
  theme: "light" | "dark" | "system";
  syncIntervalHours: number;
}

const DEFAULT_SETTINGS: UserSettings = {
  theme: "system",
  syncIntervalHours: 1,
};

export async function GET(request: NextRequest) {
  try {
    const { env } = getRequestContext();
    const db = createDb(env.DB);

    const auth = createAuth({
      DB: env.DB,
      GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
      GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: env.BETTER_AUTH_URL,
    });

    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userResult = await db
      .select({
        theme: users.theme,
        syncIntervalHours: users.syncIntervalHours,
      })
      .from(users)
      .where(eq(users.id, session.user.id));

    if (userResult.length === 0) {
      return NextResponse.json(DEFAULT_SETTINGS);
    }

    const user = userResult[0];

    return NextResponse.json({
      theme: (user.theme as UserSettings["theme"]) || DEFAULT_SETTINGS.theme,
      syncIntervalHours: user.syncIntervalHours ?? DEFAULT_SETTINGS.syncIntervalHours,
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
    const { env } = getRequestContext();
    const db = createDb(env.DB);

    const auth = createAuth({
      DB: env.DB,
      GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
      GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: env.BETTER_AUTH_URL,
    });

    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as Partial<UserSettings>;
    const updates: Partial<{ theme: string; syncIntervalHours: number; updatedAt: string }> = {
      updatedAt: new Date().toISOString(),
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
      .where(eq(users.id, session.user.id));

    // 업데이트된 설정 반환
    const userResult = await db
      .select({
        theme: users.theme,
        syncIntervalHours: users.syncIntervalHours,
      })
      .from(users)
      .where(eq(users.id, session.user.id));

    const user = userResult[0];

    return NextResponse.json({
      theme: (user?.theme as UserSettings["theme"]) || DEFAULT_SETTINGS.theme,
      syncIntervalHours: user?.syncIntervalHours ?? DEFAULT_SETTINGS.syncIntervalHours,
    });
  } catch (error) {
    console.error("Update settings error:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
