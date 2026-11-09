import type { NextRequest } from "next/server";
import { appBaseUrl } from "./withings-urls";

/**
 * The OAuth redirect URI. Must match exactly across authorize, the token
 * exchange, and the "Authorized Redirect URIs" registered on the WakaTime app
 * (https://wakatime.com/apps). Format: `${NEXT_PUBLIC_APP_URL}/api/wakatime/callback`.
 */
export function wakatimeCallbackUrl(request: NextRequest): string {
  return new URL("/api/wakatime/callback", appBaseUrl(request)).toString();
}

/**
 * The same redirect URI for request-less callers (cron refresh). WakaTime's
 * token endpoint requires `redirect_uri` on every grant, matching the authorize
 * step. Null when no app URL is configured.
 */
export function wakatimeCallbackUrlFromEnv(): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL;
  return base ? new URL("/api/wakatime/callback", base).toString() : null;
}
