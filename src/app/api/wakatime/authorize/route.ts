import { type NextRequest, NextResponse } from "next/server";
import { createWakaTimeOAuthClient } from "@/lib/adapters/wakatime/wakatime";
import { enforceRateLimit } from "@/lib/api-auth";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { createOAuthState } from "@/lib/wakatime-oauth-state";
import { wakatimeCallbackUrl } from "@/lib/wakatime-urls";
import { appBaseUrl } from "@/lib/withings-urls";

/** Begin the WakaTime OAuth flow: redirect the signed-in user to WakaTime's consent page. */
export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  // Reached by a full-page navigation (<a href>), so an expired session lands on
  // the login page rather than a raw JSON 401.
  if (error) {
    return NextResponse.redirect(new URL("/login", appBaseUrl(request)).toString());
  }

  const limit = enforceRateLimit(request, `wakatime-authorize:${user.id}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } }
    );
  }

  const clientId = process.env.WAKATIME_CLIENT_ID;
  const clientSecret = process.env.WAKATIME_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "WakaTime 연동이 설정되지 않았습니다" }, { status: 500 });
  }

  const authorizeUrl = createWakaTimeOAuthClient(clientId, clientSecret).buildAuthorizeUrl({
    redirectUri: wakatimeCallbackUrl(request),
    state: createOAuthState(user.id),
  });
  return NextResponse.redirect(authorizeUrl);
}
