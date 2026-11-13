/**
 * Shared wrapper for the MCP token settings routes: session auth (withAuth),
 * a same-origin check on every mutation, and `Cache-Control: private, no-store`
 * on every response — success or error — because issue/rotate responses carry
 * the raw token and the audit log is personal data.
 */

import type { NextRequest, NextResponse } from "next/server";
import { checkSameOrigin } from "@/lib/api-auth";
import { ApiError, type AuthContext, withAuth } from "@/lib/api-handler";
import { dateKeyToUtcMillis } from "@/lib/date-key";

export const NO_STORE = "private, no-store";

export function mcpSettingsRoute<TParams = unknown>(
  handler: (ctx: AuthContext, params: TParams) => Promise<NextResponse> | NextResponse,
  options: { mutation?: boolean; errorMessage?: string } = {}
) {
  const wrapped = withAuth<TParams>(
    async (ctx, params) => {
      if (options.mutation && !checkSameOrigin(ctx.request).ok) {
        throw new ApiError(403, "허용되지 않은 요청입니다.", "INVALID_ORIGIN");
      }
      return handler(ctx, params);
    },
    { errorMessage: options.errorMessage }
  );
  return async (request: NextRequest, params: TParams): Promise<NextResponse> => {
    const response = await wrapped(request, params);
    response.headers.set("Cache-Control", NO_STORE);
    return response;
  };
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/**
 * A `YYYY-MM-DD` KST day as the instant range [start of day, start of next
 * day). Throws a 400 with `message` when the key isn't a real date.
 */
export function kstDayBounds(dateKey: string, message: string): { start: Date; end: Date } {
  const utcMidnight = dateKeyToUtcMillis(dateKey);
  if (utcMidnight === null) throw new ApiError(400, message, "INVALID_DATE");
  const start = new Date(utcMidnight - KST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** Optional `from`/`to` KST day keys → [from start, to end) instants. */
export function kstRange(
  from: string | null | undefined,
  to: string | null | undefined
): { from?: Date; to?: Date } {
  const message = "날짜는 YYYY-MM-DD 형식이어야 합니다.";
  const start = from ? kstDayBounds(from, message).start : undefined;
  const end = to ? kstDayBounds(to, message).end : undefined;
  if (start && end && start.getTime() >= end.getTime()) {
    throw new ApiError(400, "시작일이 종료일보다 늦습니다.", "INVALID_RANGE");
  }
  return { from: start, to: end };
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
