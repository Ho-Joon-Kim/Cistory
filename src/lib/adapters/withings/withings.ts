import { logger } from "@/lib/logger";
import { BODY_SMART_MEASURE_TYPES, parseMeasureGroups } from "./measure-types";
import {
  type ParsedMeasureGroup,
  type ParsedTokens,
  WithingsApiError,
  WithingsAuthError,
  type WithingsEnvelope,
  type WithingsMeasureBody,
  type WithingsTokenBody,
} from "./types";

export const WITHINGS_ACCOUNT_URL = "https://account.withings.com";
export const WITHINGS_API_URL = "https://wbsapi.withings.net";
export const WITHINGS_DEFAULT_SCOPE = "user.metrics";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 5;
// 120 req/min = 1 request / 500ms. Use 600ms for margin (see plan Open Questions).
const DEFAULT_THROTTLE_MS = 600;
// Safety cap on getmeas pagination. Pages hold many groups, so even a multi-year
// history needs far fewer than this — the cap only exists so a malformed `more`
// response can't spin the (sequential) cron forever.
const MAX_MEASURE_PAGES = 100;

// Withings status codes. status 0 = success.
const RATE_LIMIT_STATUS = 601;
// Auth/session failures — caller should refresh the token (or re-link).
const AUTH_STATUSES = new Set([100, 101, 102, 200, 214, 277, 401, 2553, 2554, 2555]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoff(attempt: number): Promise<void> {
  return sleep(500 * 2 ** (attempt - 1));
}

interface AdapterOptions {
  throttleMs?: number;
}

export class WithingsAdapter {
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
    const url = new URL(`${WITHINGS_ACCOUNT_URL}/oauth2_user/authorize2`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("scope", opts.scope ?? WITHINGS_DEFAULT_SCOPE);
    url.searchParams.set("redirect_uri", opts.redirectUri);
    url.searchParams.set("state", opts.state);
    return url.toString();
  }

  /** Exchange an authorization code for the first access + refresh token pair. */
  async exchangeCode(opts: { code: string; redirectUri: string }): Promise<ParsedTokens> {
    return this.requestToken({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
    });
  }

  /**
   * Rotate the token pair. Withings refresh tokens are single-use: the response
   * carries a NEW refresh token that must replace the old one atomically.
   */
  async refreshToken(refreshToken: string): Promise<ParsedTokens> {
    return this.requestToken({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  }

  /**
   * Fetch measurement groups. When `lastupdate` is set, returns everything
   * created/modified since that watermark (incremental). Otherwise fetches from
   * `startdate` (default 0 = full history). Handles `more`/`offset` pagination
   * internally and returns the new `updatetime` watermark.
   */
  async getMeasurements(opts: {
    accessToken: string;
    lastupdate?: number | null;
    startdate?: number;
    meastypes?: number[];
  }): Promise<{ groups: ParsedMeasureGroup[]; updatetime: number }> {
    const meastypes = (opts.meastypes ?? BODY_SMART_MEASURE_TYPES).join(",");
    const groups: ParsedMeasureGroup[] = [];
    let offset = 0;
    let updatetime = opts.lastupdate ?? 0;
    let more = false;
    let page = 0;

    do {
      const params: Record<string, string> = {
        action: "getmeas",
        meastypes,
        category: "1",
      };
      if (opts.lastupdate != null) {
        params.lastupdate = String(opts.lastupdate);
      } else {
        params.startdate = String(opts.startdate ?? 0);
      }
      if (offset > 0) params.offset = String(offset);

      const body = await this.request<WithingsMeasureBody>("/measure", params, opts.accessToken);

      if (typeof body.updatetime === "number") updatetime = body.updatetime;
      groups.push(...parseMeasureGroups(body.measuregrps ?? []));

      // Continue only when Withings both signals `more` (0/1 or boolean) AND
      // advances the offset cursor. Requiring forward progress prevents an
      // infinite loop on a non-advancing offset; treating any truthy `more`
      // (not just === 1) avoids stopping early on an unexpected shape.
      const nextOffset = body.offset ?? 0;
      more = Boolean(body.more) && nextOffset > offset;
      offset = nextOffset;
      page++;
    } while (more && page < MAX_MEASURE_PAGES);

    if (more) {
      // Should be unreachable for a real (solo) history — surface it if a
      // malformed response ever pins `more` so a truncated page isn't mistaken
      // for a complete sync.
      logger.warn("[Withings] getmeas hit page cap; returning partial history", {
        pages: page,
        groups: groups.length,
      });
    }

    return { groups, updatetime };
  }

  private async requestToken(extra: Record<string, string>): Promise<ParsedTokens> {
    const body = await this.request<WithingsTokenBody>("/v2/oauth2", {
      action: "requesttoken",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      ...extra,
    });
    if (!body.access_token || !body.refresh_token) {
      throw new WithingsAuthError("Token response missing access/refresh token", 0);
    }
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: new Date(Date.now() + body.expires_in * 1000),
      scope: body.scope ?? "",
      withingsUserId: String(body.userid ?? ""),
    };
  }

  private async throttle(): Promise<void> {
    if (this.throttleMs <= 0) return;
    const elapsed = Date.now() - this.lastCallAt;
    if (elapsed < this.throttleMs) {
      await sleep(this.throttleMs - elapsed);
    }
    this.lastCallAt = Date.now();
  }

  private async request<T>(
    path: string,
    params: Record<string, string>,
    accessToken?: string
  ): Promise<T> {
    const url = `${WITHINGS_API_URL}${path}`;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      await this.throttle();
      try {
        const outcome = await this.attempt<T>(url, path, params, accessToken);
        if ("body" in outcome) return outcome.body;
        lastError = outcome.error; // retryable (5xx or 601)
      } catch (err) {
        // WithingsAuthError / WithingsApiError are terminal — surface immediately.
        if (err instanceof WithingsAuthError || err instanceof WithingsApiError) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
      }
      if (attempt < MAX_RETRIES) await backoff(attempt);
    }

    throw lastError ?? new Error(`Withings ${path} failed`);
  }

  /**
   * Single request attempt. Returns `{ body }` on success, `{ error }` for a
   * retryable condition (5xx or 601 rate limit), or throws a terminal
   * WithingsAuthError / WithingsApiError.
   */
  private async attempt<T>(
    url: string,
    path: string,
    params: Record<string, string>,
    accessToken?: string
  ): Promise<{ body: T } | { error: Error }> {
    const headers: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded",
    };
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status >= 500) {
      logger.warn("[Withings] 5xx response", { path, status: response.status });
      return { error: new Error(`Withings ${path} HTTP ${response.status}`) };
    }

    const data = (await response.json()) as WithingsEnvelope<T>;
    const status = data.status ?? 0;

    if (status === RATE_LIMIT_STATUS) {
      logger.warn("[Withings] rate limited (601), backing off", { path });
      return { error: new Error(`Withings ${path} rate limited (601)`) };
    }

    if (status !== 0) {
      const message = data.error?.trim() || `Withings ${path} status ${status}`;
      if (AUTH_STATUSES.has(status)) throw new WithingsAuthError(message, status);
      throw new WithingsApiError(message, status);
    }

    if (data.body === undefined) {
      throw new WithingsApiError(`Withings ${path} returned no body`, 0);
    }
    return { body: data.body };
  }
}

export function createWithingsAdapter(
  clientId: string,
  clientSecret: string,
  options?: AdapterOptions
): WithingsAdapter {
  return new WithingsAdapter(clientId, clientSecret, options);
}
