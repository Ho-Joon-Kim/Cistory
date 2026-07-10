import type { NextRequest } from "next/server";

/** App base URL, preferring configured env over the request origin (dev). */
export function appBaseUrl(request: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || request.nextUrl.origin;
}

/**
 * The OAuth redirect URI. Must match exactly across authorize, the token
 * exchange, and the URL registered in the Withings developer dashboard.
 */
export function withingsCallbackUrl(request: NextRequest): string {
  return new URL("/api/withings/callback", appBaseUrl(request)).toString();
}
