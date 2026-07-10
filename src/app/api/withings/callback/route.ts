import { type NextRequest, NextResponse } from "next/server";
import { getDb, withingsConnections } from "@/db";
import { createWithingsAdapter } from "@/lib/adapters/withings/interface";
import { enforceRateLimit } from "@/lib/api-auth";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { encryptSecret } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { verifyOAuthState } from "@/lib/withings-oauth-state";
import { appBaseUrl, withingsCallbackUrl } from "@/lib/withings-urls";
import { createWithingsSyncService } from "@/modules/withings/service";

type FailReason = "denied" | "state_invalid" | "rate_limited" | "exchange_failed";

function settingsRedirect(request: NextRequest, query: string): NextResponse {
  return NextResponse.redirect(new URL(`/settings?${query}`, appBaseUrl(request)).toString());
}

function fail(request: NextRequest, reason: FailReason): NextResponse {
  return settingsRedirect(request, `withings=error&reason=${reason}`);
}

/**
 * A network-level fetch failure surfaces as a bare "TypeError: fetch failed"; the
 * actionable reason (ETIMEDOUT, ENOTFOUND, ...) lives on `error.cause`, which
 * String(e) drops. Pull it out so ops sees the real cause, not just "fetch failed".
 */
function describeError(e: unknown): { error: string; cause?: string } {
  if (!(e instanceof Error)) return { error: String(e) };
  const cause = e.cause;
  if (cause instanceof Error) {
    return { error: e.message, cause: (cause as { code?: string }).code ?? cause.message };
  }
  return { error: e.message };
}

/** Withings redirects the user back here with `code` + `state` after consent. */
export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error) return fail(request, "state_invalid");

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return fail(request, "denied");

  const code = params.get("code");
  const verified = verifyOAuthState(params.get("state"));
  if (!code || !verified || verified.userId !== user.id) {
    return fail(request, "state_invalid");
  }

  // Cap token-exchange attempts per user so one account can't burn the shared
  // Withings 120 req/min app quota by replaying the callback. The callback is a
  // full-page redirect, so a 429 also routes back to /settings with the reason
  // rather than a bare JSON body.
  const limit = enforceRateLimit(request, `withings-callback:${user.id}`);
  if (!limit.allowed) return fail(request, "rate_limited");

  const clientId = process.env.WITHINGS_CLIENT_ID;
  const clientSecret = process.env.WITHINGS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail(request, "exchange_failed");

  try {
    const tokens = await createWithingsAdapter(clientId, clientSecret).exchangeCode({
      code,
      redirectUri: withingsCallbackUrl(request),
    });

    const db = getDb();
    const now = new Date();
    await db
      .insert(withingsConnections)
      .values({
        userId: user.id,
        withingsUserId: tokens.withingsUserId,
        accessTokenEnc: encryptSecret(tokens.accessToken),
        refreshTokenEnc: encryptSecret(tokens.refreshToken),
        accessTokenExpiresAt: tokens.expiresAt,
        scope: tokens.scope,
        status: "active",
        lastSyncError: null,
      })
      .onConflictDoUpdate({
        target: withingsConnections.userId,
        set: {
          withingsUserId: tokens.withingsUserId,
          accessTokenEnc: encryptSecret(tokens.accessToken),
          refreshTokenEnc: encryptSecret(tokens.refreshToken),
          accessTokenExpiresAt: tokens.expiresAt,
          scope: tokens.scope,
          status: "active",
          lastSyncError: null,
          updatedAt: now,
        },
      });

    // Fire-and-forget initial backfill; the cron backfill sweep self-heals if it fails.
    createWithingsSyncService(db)
      .backfillUser(user.id)
      .catch((e) =>
        logger.error("[Withings] initial backfill failed", { userId: user.id, error: String(e) })
      );

    return settingsRedirect(request, "withings=connected");
  } catch (e) {
    logger.error("[Withings] OAuth callback failed", { userId: user.id, ...describeError(e) });
    return fail(request, "exchange_failed");
  }
}
