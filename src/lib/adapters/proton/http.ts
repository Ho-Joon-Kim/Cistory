import type { ProtonSessionTokens } from "./account/auth";
import { PROTON_API_BASE_URL, PROTON_APP_VERSION } from "./constants";

export type { ProtonSessionTokens };

export type RefreshHttpResult =
  | { kind: "ok"; uid: string; accessToken: string; refreshToken?: string }
  | { kind: "rejected"; status: number }
  | { kind: "rate_limited" }
  | { kind: "transient" };

const TIMEOUT_MS = 30_000;
const BASE = `https://${PROTON_API_BASE_URL}`;

function headers(tokens: ProtonSessionTokens, accessToken?: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-pm-uid": tokens.uid,
    "x-pm-appversion": PROTON_APP_VERSION,
    ...(accessToken && { authorization: `Bearer ${accessToken}` }),
  };
}

/**
 * One refresh-token grant. Never throws and never retries: the caller (the
 * locked refresher) decides what a rejection means, so a 4xx is reported as
 * `rejected` rather than acted on here.
 */
export async function postProtonRefresh(tokens: ProtonSessionTokens): Promise<RefreshHttpResult> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/auth/v4/refresh`, {
      method: "POST",
      headers: headers(tokens, tokens.accessToken),
      body: JSON.stringify({
        ResponseType: "token",
        GrantType: "refresh_token",
        RefreshToken: tokens.refreshToken,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { kind: "transient" };
  }

  if (response.status === 429) return { kind: "rate_limited" };
  if (response.status >= 400 && response.status < 500) {
    return { kind: "rejected", status: response.status };
  }
  if (!response.ok) return { kind: "transient" };

  try {
    const data = (await response.json()) as {
      UID?: string;
      AccessToken?: string;
      RefreshToken?: string;
    };
    const uid = data.UID ?? tokens.uid;
    if (!data.AccessToken) return { kind: "transient" };
    return { kind: "ok", uid, accessToken: data.AccessToken, refreshToken: data.RefreshToken };
  } catch {
    return { kind: "transient" };
  }
}

async function deleteSession(tokens: ProtonSessionTokens, accessToken: string): Promise<number> {
  const response = await fetch(`${BASE}/auth/v4`, {
    method: "DELETE",
    headers: headers(tokens, accessToken),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return response.status;
}

/**
 * Best-effort remote sign-out. Refreshes once when the access token has
 * expired. Returns whether Proton confirmed; never throws, because a failed
 * revoke must not block local disconnect.
 */
export async function revokeProtonSession(tokens: ProtonSessionTokens): Promise<boolean> {
  try {
    const status = await deleteSession(tokens, tokens.accessToken);
    if (status >= 200 && status < 300) return true;
    if (status !== 401) return false;

    const refreshed = await postProtonRefresh(tokens);
    if (refreshed.kind !== "ok") return false;
    const retry = await deleteSession({ ...tokens, uid: refreshed.uid }, refreshed.accessToken);
    return retry >= 200 && retry < 300;
  } catch {
    return false;
  }
}
