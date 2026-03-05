/**
 * OwnTracks API Key Management
 *
 * POST /api/settings/owntracks-key - Generate new API key
 * DELETE /api/settings/owntracks-key - Revoke API key
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const db = getDb();
    const apiKey = `ot_${randomUUID().replace(/-/g, "")}`;

    await db
      .update(users)
      .set({ ownTracksApiKey: apiKey, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    return NextResponse.json({ apiKey });
  } catch (error) {
    console.error("Generate OwnTracks key error:", error);
    return NextResponse.json(
      { error: "API 키 생성에 실패했습니다" },
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
      .set({ ownTracksApiKey: null, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Revoke OwnTracks key error:", error);
    return NextResponse.json(
      { error: "API 키 삭제에 실패했습니다" },
      { status: 500 }
    );
  }
}
