import { logger } from "@/lib/logger";

const BASE_URL = "https://wakatime.com/api/v1";

// ── OAuth endpoints (https://wakatime.com/developers#authentication) ────────
export const WAKATIME_AUTHORIZE_URL = "https://wakatime.com/oauth/authorize";
export const WAKATIME_TOKEN_URL = "https://wakatime.com/oauth/token";
export const WAKATIME_REVOKE_URL = "https://wakatime.com/oauth/revoke";

/**
 * Scopes for exactly what we read: `/users/current/durations` requires
 * `read_heartbeats`, `/users/current/summaries` requires `read_summaries`. We do
 * NOT request `email` — nothing on the sync path calls `/users/current`, and the
 * account id comes back as `uid` on the token response.
 */
export const WAKATIME_DEFAULT_SCOPE = "read_summaries,read_heartbeats";

const REQUEST_TIMEOUT_MS = 30_000;

function sleepBackoff(attempt: number): Promise<void> {
  return new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface WakaTimeDuration {
  project: string | null;
  time: number;
  duration: number;
  humanAdditions: number | null;
  humanDeletions: number | null;
  aiAdditions: number | null;
  aiDeletions: number | null;
}

export interface WakaTimeSummaryItem {
  name: string;
  totalSeconds: number;
}

export interface WakaTimeDailySummary {
  date: string;
  grandTotalSeconds: number;
  projects: WakaTimeSummaryItem[];
  languages: WakaTimeSummaryItem[];
  editors: WakaTimeSummaryItem[];
  categories: WakaTimeSummaryItem[];
}

/** The data reads the sync service needs — lets the service run over either a
 *  raw Bearer adapter or the refresh-aware per-user wrapper. */
export interface WakaTimeDataSource {
  getDurations(date: string): Promise<WakaTimeDuration[]>;
  getSummaries(start: string, end: string): Promise<WakaTimeDailySummary[]>;
}

/** Raw /oauth/token JSON body (WakaTime returns JSON by default). */
export interface WakaTimeTokenResponse {
  access_token?: string;
  refresh_token?: string;
  uid?: string;
  scope?: string;
  token_type?: string;
  expires_in?: number | string;
  expires_at?: string;
  error?: string;
  error_description?: string;
}

export interface WakaTimeTokens {
  accessToken: string;
  /** On refresh, the *preserved* token when the response omits one. */
  refreshToken: string;
  /** Null when the response carries no expiry (code-flow tokens live ~100 years). */
  expiresAt: Date | null;
  scope: string | null;
  wakatimeUserId: string | null;
}

/**
 * Auth failure. On a data read (401) = the access token was rejected → caller
 * refreshes and retries once. On the token endpoint (`invalid_grant`) = the grant
 * is revoked/expired → CONFIRMED, caller marks the connection `needs_reauth`.
 */
export class WakaTimeAuthError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "WakaTimeAuthError";
  }
}

/** Any other non-retryable WakaTime error (400/402/403/404, malformed body). */
export class WakaTimeApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "WakaTimeApiError";
  }
}

// ── Token parsing ──────────────────────────────────────────────────────────────

/**
 * Normalize a token response. WakaTime's docs do not state whether a refresh
 * rotates the refresh token, so handle both: a returned `refresh_token` replaces
 * the stored one (rotation), an omitted one preserves `previousRefreshToken`.
 */
export function parseTokenResponse(
  data: WakaTimeTokenResponse,
  now: number,
  previousRefreshToken?: string
): WakaTimeTokens {
  if (!data.access_token) throw new WakaTimeApiError("token response missing access_token", 0);
  const refreshToken = data.refresh_token || previousRefreshToken;
  if (!refreshToken) throw new WakaTimeApiError("token response missing refresh_token", 0);

  let expiresAt: Date | null = null;
  const expiresIn = Number(data.expires_in);
  if (data.expires_in !== undefined && Number.isFinite(expiresIn) && expiresIn > 0) {
    expiresAt = new Date(now + expiresIn * 1000);
  } else if (data.expires_at) {
    const parsed = new Date(data.expires_at);
    if (Number.isFinite(parsed.getTime())) expiresAt = parsed;
  }

  return {
    accessToken: data.access_token,
    refreshToken,
    expiresAt,
    scope: data.scope ?? null,
    wakatimeUserId: data.uid ?? null,
  };
}

// ── OAuth client ─────────────────────────────────────────────────────────────

export class WakaTimeOAuthClient {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string
  ) {}

  buildAuthorizeUrl(opts: { redirectUri: string; state: string; scope?: string }): string {
    const url = new URL(WAKATIME_AUTHORIZE_URL);
    url.searchParams.set("client_id", this.clientId);
    // `code` (not `token`): code-flow tokens are long-lived and come with a refresh token.
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", opts.redirectUri);
    url.searchParams.set("scope", opts.scope ?? WAKATIME_DEFAULT_SCOPE);
    url.searchParams.set("state", opts.state);
    return url.toString();
  }

  async exchangeCode(opts: { code: string; redirectUri: string }): Promise<WakaTimeTokens> {
    const data = await this.tokenRequest({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    return parseTokenResponse(data, Date.now());
  }

  async refreshToken(opts: { refreshToken: string; redirectUri: string }): Promise<WakaTimeTokens> {
    const data = await this.tokenRequest({
      grant_type: "refresh_token",
      refresh_token: opts.refreshToken,
      redirect_uri: opts.redirectUri,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    return parseTokenResponse(data, Date.now(), opts.refreshToken);
  }

  /** Best-effort revoke on disconnect. Throws on failure; callers swallow it. */
  async revokeToken(token: string): Promise<void> {
    const res = await fetch(WAKATIME_REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        token,
      }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await res.text().catch(() => undefined);
    if (!res.ok) throw new WakaTimeApiError(`revoke HTTP ${res.status}`, res.status);
  }

  private async tokenRequest(params: Record<string, string>): Promise<WakaTimeTokenResponse> {
    const res = await this.postTokenWithRetry(new URLSearchParams(params).toString());
    const text = await res.text();
    let data: WakaTimeTokenResponse;
    try {
      data = JSON.parse(text) as WakaTimeTokenResponse;
    } catch {
      throw new WakaTimeApiError(`token HTTP ${res.status}: non-JSON body`, res.status);
    }
    if (res.ok && !data.error) return data;
    const msg = data.error_description || data.error || `token HTTP ${res.status}`;
    // invalid_grant = the refresh token / code is revoked or expired — the only
    // CONFIRMED signal that the user must reconnect.
    if (data.error === "invalid_grant") throw new WakaTimeAuthError(msg, res.status);
    throw new WakaTimeApiError(msg, res.status);
  }

  /** POST to the token endpoint, retrying network errors, 429 and 5xx. */
  private async postTokenWithRetry(body: string): Promise<Response> {
    const maxAttempts = 3;
    for (let attempt = 1; ; attempt++) {
      const last = attempt >= maxAttempts;
      try {
        const res = await fetch(WAKATIME_TOKEN_URL, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
          },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (last || (res.status !== 429 && res.status < 500)) return res;
        await res.text().catch(() => undefined);
      } catch (err) {
        if (last) throw err;
      }
      await sleepBackoff(attempt);
    }
  }
}

export function createWakaTimeOAuthClient(
  clientId: string,
  clientSecret: string
): WakaTimeOAuthClient {
  return new WakaTimeOAuthClient(clientId, clientSecret);
}

// ── Data adapter (Bearer) ────────────────────────────────────────────────────

/**
 * Data reads authenticated with an OAuth access token. WakaTime API keys are
 * "write-only and should only be used in WakaTime plugins"; reads with
 * `Authorization: Basic <api key>` now fail with 403 "API Keys are only for
 * plugins, use your personal oauth token".
 */
export class WakaTimeAdapter implements WakaTimeDataSource {
  private authHeader: string;

  constructor(accessToken: string) {
    this.authHeader = `Bearer ${accessToken}`;
  }

  private async fetchOnce(endpoint: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(`${BASE_URL}${endpoint}`, {
        headers: { Authorization: this.authHeader },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseOrThrow<T>(endpoint: string, response: Response): Promise<T> {
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      logger.error("WakaTime API error", {
        endpoint,
        status: response.status,
        body: text.slice(0, 200),
      });
      if (response.status === 401) {
        throw new WakaTimeAuthError("WakaTime API unauthorized", 401);
      }
      throw new WakaTimeApiError(`WakaTime API error: ${response.status}`, response.status);
    }
    return (await response.json()) as T;
  }

  private async fetch<T>(endpoint: string): Promise<T> {
    const maxAttempts = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.fetchOnce(endpoint);
        const retriable = response.status >= 500 || response.status === 429;
        if (retriable && attempt < maxAttempts) {
          lastError = new Error(`WakaTime API transient ${response.status}`);
          await sleepBackoff(attempt);
          continue;
        }
        return await this.parseOrThrow<T>(endpoint, response);
      } catch (err) {
        lastError = err;
        const transient =
          (err instanceof Error && err.name === "AbortError") || err instanceof TypeError;
        if (transient && attempt < maxAttempts) {
          await sleepBackoff(attempt);
          continue;
        }
        throw err;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("WakaTime API failed");
  }

  async getDurations(date: string): Promise<WakaTimeDuration[]> {
    interface RawDuration {
      project: string | null;
      time: number;
      duration: number;
      human_additions?: number | null;
      human_deletions?: number | null;
      ai_additions?: number | null;
      ai_deletions?: number | null;
    }

    const data = await this.fetch<{ data: RawDuration[] }>(
      `/users/current/durations?date=${date}&timezone=Asia%2FSeoul`
    );

    return data.data.map((d) => ({
      project: d.project,
      time: d.time,
      duration: d.duration,
      humanAdditions: d.human_additions ?? null,
      humanDeletions: d.human_deletions ?? null,
      aiAdditions: d.ai_additions ?? null,
      aiDeletions: d.ai_deletions ?? null,
    }));
  }

  async getSummaries(start: string, end: string): Promise<WakaTimeDailySummary[]> {
    interface RawSummaryItem {
      name: string;
      total_seconds: number;
    }
    interface RawDaySummary {
      range: { date: string };
      grand_total: { total_seconds: number };
      projects: RawSummaryItem[];
      languages: RawSummaryItem[];
      editors: RawSummaryItem[];
      categories: RawSummaryItem[];
    }

    const data = await this.fetch<{ data: RawDaySummary[] }>(
      `/users/current/summaries?start=${start}&end=${end}&timezone=Asia%2FSeoul`
    );

    const mapItems = (items: RawSummaryItem[]) =>
      items.map((i) => ({ name: i.name, totalSeconds: i.total_seconds }));

    return data.data.map((d) => ({
      date: d.range.date,
      grandTotalSeconds: d.grand_total.total_seconds,
      projects: mapItems(d.projects),
      languages: mapItems(d.languages),
      editors: mapItems(d.editors),
      categories: mapItems(d.categories),
    }));
  }
}

export function createWakaTimeAdapter(accessToken: string): WakaTimeAdapter {
  return new WakaTimeAdapter(accessToken);
}
