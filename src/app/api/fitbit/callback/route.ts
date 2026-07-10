import { type NextRequest, NextResponse } from "next/server";
import { getDb, healthConnections } from "@/db";
import { createGoogleHealthAdapter } from "@/lib/adapters/google-health/interface";
import { enforceRateLimit } from "@/lib/api-auth";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { encryptSecret } from "@/lib/crypto";
import { appBaseUrl, fitbitCallbackUrl } from "@/lib/google-health-urls";
import { verifyOAuthState } from "@/lib/google-oauth-state";
import { logger } from "@/lib/logger";

type FailReason = "denied" | "state_invalid" | "rate_limited" | "exchange_failed";

function settingsRedirect(request: NextRequest, query: string): NextResponse {
  return NextResponse.redirect(new URL(`/settings?${query}`, appBaseUrl(request)).toString());
}

function fail(request: NextRequest, reason: FailReason): NextResponse {
  return settingsRedirect(request, `health=error&reason=${reason}`);
}

/**
 * A network-level fetch failure surfaces as a bare "TypeError: fetch failed"; the
 * actionable reason (ETIMEDOUT, ENOTFOUND, ...) lives on `error.cause`, which
 * String(e) drops. Pull it out so ops sees the real cause. Never log tokens/PII.
 */
function describeError(e: unknown): { error: string; cause?: string } {
  if (!(e instanceof Error)) return { error: String(e) };
  const cause = e.cause;
  if (cause instanceof Error) {
    return { error: e.message, cause: (cause as { code?: string }).code ?? cause.message };
  }
  return { error: e.message };
}

/** Google redirects the user back here with `code` + `state` after consent. */
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

  const limit = enforceRateLimit(request, `fitbit-callback:${user.id}`);
  if (!limit.allowed) return fail(request, "rate_limited");

  const clientId = process.env.FITBIT_CLIENT_ID;
  const clientSecret = process.env.FITBIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail(request, "exchange_failed");

  try {
    const tokens = await createGoogleHealthAdapter(clientId, clientSecret).exchangeCode({
      code,
      redirectUri: fitbitCallbackUrl(request),
    });

    const db = getDb();
    const now = new Date();
    // Upsert the connection, leaving each metric's backfilledFrom null. We do NOT
    // kick off a backfill here: this callback runs in the WEB container and an
    // intraday backfill would block the event loop (R7). The cron worker (U6)
    // sees the null watermarks and backfills there; until then the /health page
    // shows the "backfilling" state (R12).
    await db
      .insert(healthConnections)
      .values({
        userId: user.id,
        googleSub: tokens.googleSub,
        accessTokenEnc: encryptSecret(tokens.accessToken),
        refreshTokenEnc: encryptSecret(tokens.refreshToken),
        accessTokenExpiresAt: tokens.expiresAt,
        scope: tokens.scope,
        status: "active",
        lastSyncError: null,
      })
      .onConflictDoUpdate({
        target: healthConnections.userId,
        set: {
          googleSub: tokens.googleSub,
          accessTokenEnc: encryptSecret(tokens.accessToken),
          refreshTokenEnc: encryptSecret(tokens.refreshToken),
          accessTokenExpiresAt: tokens.expiresAt,
          scope: tokens.scope,
          status: "active",
          lastSyncError: null,
          updatedAt: now,
        },
      });

    return settingsRedirect(request, "health=connected");
  } catch (e) {
    logger.error("[Health] OAuth callback failed", { userId: user.id, ...describeError(e) });
    return fail(request, "exchange_failed");
  }
}
