import { type NextRequest, NextResponse } from "next/server";
import { createWithingsAdapter } from "@/lib/adapters/withings/interface";
import { enforceRateLimit } from "@/lib/api-auth";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { createOAuthState } from "@/lib/withings-oauth-state";
import { appBaseUrl, withingsCallbackUrl } from "@/lib/withings-urls";

/** Begin the Withings OAuth flow: redirect the signed-in user to Withings' consent page. */
export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  // This route is reached by a full-page navigation (a plain <a href>), so an
  // expired session should land on the login page — not render a raw JSON 401.
  if (error) {
    return NextResponse.redirect(new URL("/login", appBaseUrl(request)).toString());
  }

  const limit = enforceRateLimit(request, `withings-authorize:${user.id}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } }
    );
  }

  const clientId = process.env.WITHINGS_CLIENT_ID;
  const clientSecret = process.env.WITHINGS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Withings 연동이 설정되지 않았습니다" }, { status: 500 });
  }

  const authorizeUrl = createWithingsAdapter(clientId, clientSecret).buildAuthorizeUrl({
    redirectUri: withingsCallbackUrl(request),
    state: createOAuthState(user.id),
  });

  return NextResponse.redirect(authorizeUrl);
}
