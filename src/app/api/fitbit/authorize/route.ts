import { type NextRequest, NextResponse } from "next/server";
import {
  buildHealthScope,
  createGoogleHealthAdapter,
} from "@/lib/adapters/google-health/interface";
import { enforceRateLimit } from "@/lib/api-auth";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { appBaseUrl, fitbitCallbackUrl } from "@/lib/google-health-urls";
import { createOAuthState } from "@/lib/google-oauth-state";

/** Begin the Google Health OAuth flow: redirect the signed-in user to Google's consent page. */
export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  // This route is reached by a full-page navigation (a plain <a href>), so an
  // expired session should land on the login page — not render a raw JSON 401.
  if (error) {
    return NextResponse.redirect(new URL("/login", appBaseUrl(request)).toString());
  }

  const limit = enforceRateLimit(request, `fitbit-authorize:${user.id}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } }
    );
  }

  const clientId = process.env.FITBIT_CLIENT_ID;
  const clientSecret = process.env.FITBIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        error:
          "서버에 Google Health (Fitbit) 연결이 설정되어 있지 않습니다. 관리자에게 문의해 주세요.",
      },
      { status: 500 }
    );
  }

  // `?extra=ecg,irn` adds the optional ECG / irregular-rhythm scopes on top of the
  // default set (incremental consent; include_granted_scopes keeps the rest).
  const extra = (request.nextUrl.searchParams.get("extra") ?? "").split(",").filter(Boolean);
  const authorizeUrl = createGoogleHealthAdapter(clientId, clientSecret).buildAuthorizeUrl({
    redirectUri: fitbitCallbackUrl(request),
    state: createOAuthState(user.id),
    scope: buildHealthScope(extra),
  });

  return NextResponse.redirect(authorizeUrl);
}
