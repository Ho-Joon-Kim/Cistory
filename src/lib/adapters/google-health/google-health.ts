import { Agent, fetch as undiciFetch } from "undici";
import { logger } from "@/lib/logger";

// ── Endpoints ────────────────────────────────────────────────────────────────
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const HEALTH_API_BASE = "https://health.googleapis.com/v4";

// Google Health API readonly scopes (verified against developers.google.com/health/scopes).
// The API uses broad CATEGORY scopes, not per-metric; these three cover the metrics
// we sync (activity/steps/vo2max, sleep, and the health-metrics bucket = heart rate,
// resting HR, HRV, SpO2, body temp). All are Restricted. `openid` yields an id_token
// we read `sub` from. U1 confirms the final set; callers may override via buildAuthorizeUrl.
export const GOOGLE_HEALTH_DEFAULT_SCOPE = [
  "openid",
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
].join(" ");

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 5;
// Google Health quotas are per-minute but far looser than Withings'. A small
// self-paced throttle keeps us polite; tests pass throttleMs: 0.
const DEFAULT_THROTTLE_MS = 100;
// Safety backstop on pagination. Windows are span-capped by the caller, so a
// real page count is far below this — the cap only stops a malformed
// never-empty nextPageToken from spinning the (sequential) cron forever.
const MAX_PAGES = 1000;

// Force IPv4 for every Google request. googleapis hosts are dual-stack, and the
// IPv6 route is a black hole from some dev hosts (see user memory
// project_dev_host_ipv6_blackhole); undici's connector otherwise picks IPv6 and
// stalls until ETIMEDOUT, surfacing as "TypeError: fetch failed". Scoped to this
// adapter's own undici fetch, so it needs no global/process state. (Docker's
// default bridge is IPv4-only, so this is a no-op there.)
const ipv4Dispatcher = new Agent({ connect: { family: 4 } });

// ── Types ────────────────────────────────────────────────────────────────────

/** Raw Google OAuth token response. `refresh_token` is present on the initial
 *  code exchange but usually OMITTED on refresh — Google does not rotate it. */
export interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

export interface ParsedTokens {
  accessToken: string;
  /** On refresh, this is the *preserved* token when the response omits one. */
  refreshToken: string;
  expiresAt: Date;
  scope: string;
  /** Google account subject from the id_token, or null if none was returned. */
  googleSub: string | null;
}

/** A Google Health data point. Its exact shape is metric-dependent and confirmed
 *  by the U1 spike, so it stays opaque here — U5 normalizes it per metric. */
export type GoogleHealthDataPoint = Record<string, unknown>;

export interface ListResult {
  dataPoints: GoogleHealthDataPoint[];
  nextPageToken?: string;
}

export interface RollUpResult {
  rollupDataPoints: GoogleHealthDataPoint[];
  nextPageToken?: string;
}

/** Auth/token failure. On a data read = refresh the access token and retry; on a
 *  refresh call (invalid_grant) = confirmed revocation, caller marks needs_reauth. */
export class GoogleHealthAuthError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "GoogleHealthAuthError";
  }
}

/** Any other non-retryable Google error (400/403/404, malformed body). A 403 or
 *  empty read for one metric is caught per-metric by the service (AE4 skip). */
export class GoogleHealthApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "GoogleHealthApiError";
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoff(attempt: number): Promise<void> {
  return sleep(500 * 2 ** (attempt - 1));
}

/** Decode the `sub` claim from an id_token JWT without verifying it (we trust the
 *  TLS channel to Google's token endpoint). Returns null on any malformation. */
function subFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const sub = (JSON.parse(json) as { sub?: string }).sub;
    return sub ?? null;
  } catch {
    return null;
  }
}

interface AdapterOptions {
  throttleMs?: number;
}

export class GoogleHealthAdapter {
  private lastCallAt = 0;
  private readonly throttleMs: number;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    options: AdapterOptions = {}
  ) {
    this.throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  }

  /** Build the OAuth2 authorize URL the user is redirected to. */
  buildAuthorizeUrl(opts: { redirectUri: string; state: string; scope?: string }): string {
    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", opts.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", opts.scope ?? GOOGLE_HEALTH_DEFAULT_SCOPE);
    // offline + consent guarantee a refresh token on every grant.
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("state", opts.state);
    return url.toString();
  }

  /** Exchange an authorization code for the first access + refresh token pair. */
  async exchangeCode(opts: { code: string; redirectUri: string }): Promise<ParsedTokens> {
    const data = await this.tokenRequest({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    if (!data.refresh_token) {
      throw new GoogleHealthApiError(
        "Token exchange returned no refresh_token (need access_type=offline & prompt=consent)",
        0
      );
    }
    return this.toParsedTokens(data);
  }

  /**
   * Refresh the access token. Google refresh tokens do NOT rotate — the response
   * usually omits `refresh_token`, so the previously-stored one is preserved. This
   * is the key divergence from Withings (which rotates and replaces).
   */
  async refreshToken(refreshToken: string): Promise<ParsedTokens> {
    const data = await this.tokenRequest({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    return this.toParsedTokens(data, refreshToken);
  }

  /** Best-effort revoke on disconnect. Idempotent: an already-invalid token (400)
   *  is treated as success. */
  async revokeToken(token: string): Promise<void> {
    await this.withRetry("revoke", async () => {
      const res = await undiciFetch(GOOGLE_REVOKE_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
        dispatcher: ipv4Dispatcher,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status === 429 || res.status >= 500) {
        logger.warn("[GoogleHealth] revoke retryable", { status: res.status });
        return { error: new Error(`revoke HTTP ${res.status}`) };
      }
      // 200 = revoked; 400 = token already invalid (idempotent success).
      if (!res.ok && res.status !== 400) {
        throw new GoogleHealthApiError(`revoke HTTP ${res.status}`, res.status);
      }
      return { body: undefined };
    });
  }

  /**
   * List intraday data points for a metric (paged by caller). Time filtering uses
   * the API's AIP-160 `filter` param — there is NO startTime/endTime query param.
   * The filter field is metric-specific (e.g. `steps.interval.start_time >= "..."`
   * / `heart-rate.sample_time.physical_time >= "..."`), so the caller (U5) builds
   * it from the U1-confirmed per-metric shape. Omit `filter` to get recent points.
   */
  async listDataPoints(opts: {
    accessToken: string;
    dataType: string;
    filter?: string;
    pageSize?: number;
    pageToken?: string;
  }): Promise<ListResult> {
    const url = new URL(
      `${HEALTH_API_BASE}/users/me/dataTypes/${encodeURIComponent(opts.dataType)}/dataPoints`
    );
    if (opts.filter) url.searchParams.set("filter", opts.filter);
    if (opts.pageSize) url.searchParams.set("pageSize", String(opts.pageSize));
    if (opts.pageToken) url.searchParams.set("pageToken", opts.pageToken);

    const data = await this.apiRequest<{
      dataPoints?: GoogleHealthDataPoint[];
      nextPageToken?: string;
    }>("GET", url.toString(), opts.accessToken, `list/${opts.dataType}`);
    return { dataPoints: data.dataPoints ?? [], nextPageToken: data.nextPageToken };
  }

  /**
   * Daily rollup (server-aggregated) for a metric over a civil-date range. The body
   * uses `range: { start, end }` (closed-open CivilDate interval) + `windowSizeDays`
   * — NOT `localDateRange`. `start` must be aligned to the aggregation window.
   */
  async dailyRollUp(opts: {
    accessToken: string;
    dataType: string;
    range: {
      start: { year: number; month: number; day: number };
      end: { year: number; month: number; day: number };
    };
    windowSizeDays?: number;
    pageToken?: string;
  }): Promise<RollUpResult> {
    const url = `${HEALTH_API_BASE}/users/me/dataTypes/${encodeURIComponent(
      opts.dataType
    )}/dataPoints:dailyRollUp`;
    const body: Record<string, unknown> = { range: opts.range };
    if (opts.windowSizeDays != null) body.windowSizeDays = opts.windowSizeDays;
    if (opts.pageToken) body.pageToken = opts.pageToken;

    // Response key not yet confirmed against a 200 — tolerate rollupDataPoints or dataPoints.
    const data = await this.apiRequest<{
      rollupDataPoints?: GoogleHealthDataPoint[];
      dataPoints?: GoogleHealthDataPoint[];
      nextPageToken?: string;
    }>("POST", url, opts.accessToken, `dailyRollUp/${opts.dataType}`, body);
    return {
      rollupDataPoints: data.rollupDataPoints ?? data.dataPoints ?? [],
      nextPageToken: data.nextPageToken,
    };
  }

  /**
   * Convenience: exhaust `list` pagination for a window into one array. Bounded by
   * MAX_PAGES so a malformed never-empty nextPageToken can't loop forever.
   */
  async listAllDataPoints(opts: {
    accessToken: string;
    dataType: string;
    filter?: string;
    pageSize?: number;
  }): Promise<GoogleHealthDataPoint[]> {
    const all: GoogleHealthDataPoint[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    do {
      const page = await this.listDataPoints({ ...opts, pageToken });
      all.push(...page.dataPoints);
      pageToken = page.nextPageToken;
      pages++;
    } while (pageToken && pages < MAX_PAGES);
    if (pageToken) {
      logger.warn("[GoogleHealth] list hit page cap; returning partial window", {
        dataType: opts.dataType,
        pages,
        points: all.length,
      });
    }
    return all;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private toParsedTokens(data: GoogleTokenResponse, fallbackRefresh?: string): ParsedTokens {
    if (!data.access_token) {
      throw new GoogleHealthAuthError("Token response missing access_token", 0);
    }
    return {
      accessToken: data.access_token,
      // Non-rotation: keep the existing refresh token when the response omits one.
      refreshToken: data.refresh_token ?? fallbackRefresh ?? "",
      expiresAt: new Date(Date.now() + (data.expires_in ?? 0) * 1000),
      scope: data.scope ?? "",
      googleSub: subFromIdToken(data.id_token),
    };
  }

  private async tokenRequest(params: Record<string, string>): Promise<GoogleTokenResponse> {
    return this.withRetry<GoogleTokenResponse>("token", async () => {
      const res = await undiciFetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString(),
        dispatcher: ipv4Dispatcher,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status === 429 || res.status >= 500) {
        logger.warn("[GoogleHealth] token retryable", { status: res.status });
        return { error: new Error(`token HTTP ${res.status}`) };
      }
      const text = await res.text();
      let data: GoogleTokenResponse;
      try {
        data = JSON.parse(text) as GoogleTokenResponse;
      } catch {
        throw new GoogleHealthApiError(`token HTTP ${res.status}: non-JSON body`, res.status);
      }
      if (!res.ok) {
        const msg = data.error_description || data.error || `token HTTP ${res.status}`;
        // invalid_grant = the refresh token / auth code is revoked or expired.
        if (data.error === "invalid_grant") throw new GoogleHealthAuthError(msg, res.status);
        throw new GoogleHealthApiError(msg, res.status);
      }
      return { body: data };
    });
  }

  private async apiRequest<T>(
    method: "GET" | "POST",
    url: string,
    accessToken: string,
    label: string,
    body?: unknown
  ): Promise<T> {
    return this.withRetry<T>(label, async () => {
      const headers: Record<string, string> = { authorization: `Bearer ${accessToken}` };
      if (body !== undefined) headers["content-type"] = "application/json";
      const res = await undiciFetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        dispatcher: ipv4Dispatcher,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      // 401 = access token invalid → caller refreshes and retries (terminal here).
      // Do NOT echo the response body — a data-read response can carry health
      // values, and this message travels into logs/Sentry (R13). Status only.
      if (res.status === 401) {
        await res.text().catch(() => undefined); // drain the body, discard it
        throw new GoogleHealthAuthError(`${label} unauthorized`, 401);
      }
      if (res.status === 429 || res.status >= 500) {
        logger.warn("[GoogleHealth] api retryable", { label, status: res.status });
        return { error: new Error(`${label} HTTP ${res.status}`) };
      }
      const text = await res.text();
      if (!res.ok) {
        // Same R13 concern — never put the response body in the error message.
        throw new GoogleHealthApiError(`${label} HTTP ${res.status}`, res.status);
      }
      return { body: (text ? JSON.parse(text) : {}) as T };
    });
  }

  private async throttle(): Promise<void> {
    if (this.throttleMs <= 0) return;
    const elapsed = Date.now() - this.lastCallAt;
    if (elapsed < this.throttleMs) await sleep(this.throttleMs - elapsed);
    this.lastCallAt = Date.now();
  }

  /**
   * Retry driver. `attempt` returns `{ body }` on success or `{ error }` for a
   * retryable condition (429/5xx/network); terminal GoogleHealth*Error thrown
   * inside is surfaced immediately.
   */
  private async withRetry<T>(
    label: string,
    attempt: () => Promise<{ body: T } | { error: Error }>
  ): Promise<T> {
    let lastError: Error | null = null;
    for (let i = 1; i <= MAX_RETRIES; i++) {
      await this.throttle();
      try {
        const out = await attempt();
        if ("body" in out) return out.body;
        lastError = out.error;
      } catch (err) {
        if (err instanceof GoogleHealthAuthError || err instanceof GoogleHealthApiError) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
      }
      if (i < MAX_RETRIES) await backoff(i);
    }
    throw lastError ?? new Error(`Google Health ${label} failed`);
  }
}

export function createGoogleHealthAdapter(
  clientId: string,
  clientSecret: string,
  options?: AdapterOptions
): GoogleHealthAdapter {
  return new GoogleHealthAdapter(clientId, clientSecret, options);
}
