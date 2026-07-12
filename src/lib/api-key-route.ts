/**
 * Factory for simple prefix-based API key CRUD routes.
 *
 * OwnTracks and Toss follow the exact same shape:
 *   POST   → generate `${prefix}${uuid}` and store
 *   DELETE → null out the column
 *
 * Export the generated handlers from the route file:
 *   const { POST, DELETE } = createApiKeyRoute({ column: "ownTracksApiKey", prefix: "ot_" });
 *   export { POST, DELETE };
 *
 * WakaTime is *not* a simple prefix route (external verification + initial
 * sync) and intentionally stays hand-written.
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb, users } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";

type ApiKeyColumn = "ownTracksApiKey" | "tossNotificationApiKey" | "healthImportApiKey";

interface Options {
  column: ApiKeyColumn;
  prefix: string;
  /** Human-readable name used in log + error messages. */
  label: string;
}

export function createApiKeyRoute({ column, prefix, label }: Options) {
  async function POST(request: NextRequest) {
    try {
      const { user, error: authError } = await getAuthenticatedUser(request);
      if (authError) return authError;

      const apiKey = `${prefix}${randomUUID().replace(/-/g, "")}`;

      const db = getDb();
      await db
        .update(users)
        .set({ [column]: apiKey, updatedAt: new Date() })
        .where(eq(users.id, user.id));

      return NextResponse.json({ apiKey });
    } catch (error) {
      logger.error(`Generate ${label} key error`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json({ error: "API 키 생성에 실패했습니다" }, { status: 500 });
    }
  }

  async function DELETE(request: NextRequest) {
    try {
      const { user, error: authError } = await getAuthenticatedUser(request);
      if (authError) return authError;

      const db = getDb();
      await db
        .update(users)
        .set({ [column]: null, updatedAt: new Date() })
        .where(eq(users.id, user.id));

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error(`Revoke ${label} key error`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json({ error: "API 키 삭제에 실패했습니다" }, { status: 500 });
    }
  }

  return { POST, DELETE };
}
