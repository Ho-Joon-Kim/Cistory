/**
 * API route handler wrappers
 *
 * Provides common middleware for Next.js App Router route handlers:
 * - withAuth: ensures an authenticated user, surfaces as `ctx.user`
 * - withValidation: parses body against a zod schema, surfaces as `ctx.body`
 * - ApiError: throw from handlers to produce structured JSON error responses
 *
 * Response shape on error: { error: string, code?: string }
 */

import { type NextRequest, NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";

type AppUser = { id: string; email: string | null };

export interface AuthContext {
  user: AppUser;
  request: NextRequest;
}

export interface ValidatedContext<TBody> extends AuthContext {
  body: TBody;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function errorResponse(err: unknown, fallbackMessage: string): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: "요청 형식이 올바르지 않습니다", code: "VALIDATION", issues: err.issues },
      { status: 400 }
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  logger.error(fallbackMessage, { error: message });
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}

/**
 * Wrap a route handler with session-based authentication.
 *
 * Usage:
 *   export const GET = withAuth(async ({ user, request }) => {
 *     return NextResponse.json({ id: user.id });
 *   });
 */
export function withAuth<TParams = unknown>(
  handler: (ctx: AuthContext, params: TParams) => Promise<NextResponse> | NextResponse,
  options?: { errorMessage?: string }
) {
  return async (request: NextRequest, params: TParams): Promise<NextResponse> => {
    try {
      const { user, error } = await getAuthenticatedUser(request);
      if (error) return error;
      return await handler({ user, request }, params);
    } catch (err) {
      return errorResponse(err, options?.errorMessage ?? "요청 처리에 실패했습니다");
    }
  };
}

/**
 * Wrap a route handler with session auth + zod body validation.
 *
 * Usage:
 *   const Body = z.object({ year: z.string().regex(/^\d{4}$/) });
 *   export const POST = withValidation(Body, async ({ user, body }) => {
 *     return NextResponse.json({ year: body.year });
 *   });
 */
export function withValidation<TSchema extends ZodType, TParams = unknown>(
  schema: TSchema,
  handler: (
    ctx: ValidatedContext<ReturnType<TSchema["parse"]>>,
    params: TParams
  ) => Promise<NextResponse> | NextResponse,
  options?: { errorMessage?: string }
) {
  return async (request: NextRequest, params: TParams): Promise<NextResponse> => {
    try {
      const { user, error } = await getAuthenticatedUser(request);
      if (error) return error;
      const raw = await request.json().catch(() => ({}));
      const body = schema.parse(raw) as ReturnType<TSchema["parse"]>;
      return await handler({ user, request, body }, params);
    } catch (err) {
      return errorResponse(err, options?.errorMessage ?? "요청 처리에 실패했습니다");
    }
  };
}
