import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb, users, wakatimeConnections } from "@/db";
import { createWakaTimeOAuthClient } from "@/lib/adapters/wakatime/wakatime";
import { enforceRateLimit } from "@/lib/api-auth";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { encryptSecret } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { verifyOAuthState } from "@/lib/wakatime-oauth-state";
import { wakatimeCallbackUrl } from "@/lib/wakatime-urls";
import { appBaseUrl } from "@/lib/withings-urls";
import { createWakaTimeSyncServiceForUser } from "@/modules/wakatime/service";

type FailReason = "denied" | "state_invalid" | "rate_limited" | "exchange_failed";

function settingsRedirect(request: NextRequest, query: string): NextResponse {
  return NextResponse.redirect(new URL(`/settings?${query}`, appBaseUrl(request)).toString());
}

function fail(request: NextRequest, reason: FailReason): NextResponse {
  return settingsRedirect(request, `wakatime=error&reason=${reason}`);
}

/** WakaTime redirects the user back here with `code` + `state` after consent. */
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

  // Cap token-exchange attempts per user so a replayed callback can't hammer
  // WakaTime's token endpoint.
  const limit = enforceRateLimit(request, `wakatime-callback:${user.id}`);
  if (!limit.allowed) return fail(request, "rate_limited");

  const clientId = process.env.WAKATIME_CLIENT_ID;
  const clientSecret = process.env.WAKATIME_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail(request, "exchange_failed");

  try {
    const tokens = await createWakaTimeOAuthClient(clientId, clientSecret).exchangeCode({
      code,
      redirectUri: wakatimeCallbackUrl(request),
    });

    const db = getDb();
    const fields = {
      wakatimeUserId: tokens.wakatimeUserId,
      accessTokenEnc: encryptSecret(tokens.accessToken),
      refreshTokenEnc: encryptSecret(tokens.refreshToken),
      accessTokenExpiresAt: tokens.expiresAt,
      scope: tokens.scope,
      status: "active",
      lastSyncError: null,
    };
    await db
      .insert(wakatimeConnections)
      .values({ userId: user.id, ...fields })
      .onConflictDoUpdate({
        target: wakatimeConnections.userId,
        set: { ...fields, updatedAt: new Date() },
      });
    // The deprecated API key is dead weight once OAuth is linked — drop it so the
    // settings card stops showing the reconnect prompt.
    await db
      .update(users)
      .set({ wakatimeApiKey: null, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    // Fire-and-forget catch-up from the existing watermark; the 10-min cron
    // self-heals if this fails. Older gaps are recovered from /data-status.
    createWakaTimeSyncServiceForUser(db, user.id)
      .then((service) => service?.syncUser(user.id))
      .catch((e) =>
        logger.error("[WakaTime] initial sync after connect failed", {
          userId: user.id,
          error: e instanceof Error ? e.message : String(e),
        })
      );

    return settingsRedirect(request, "wakatime=connected");
  } catch (e) {
    logger.error("[WakaTime] OAuth callback failed", {
      userId: user.id,
      error: e instanceof Error ? e.message : String(e),
    });
    return fail(request, "exchange_failed");
  }
}
