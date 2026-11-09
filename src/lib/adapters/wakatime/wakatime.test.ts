import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseTokenResponse,
  WAKATIME_TOKEN_URL,
  WakaTimeAdapter,
  WakaTimeApiError,
  WakaTimeAuthError,
  WakaTimeOAuthClient,
} from "./wakatime";

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("WakaTime calendar windows", () => {
  it("requests durations and summaries in KST regardless of account timezone", async () => {
    const fetch = vi.fn().mockImplementation(async () => json({ data: [] }));
    vi.stubGlobal("fetch", fetch);
    const adapter = new WakaTimeAdapter("tok");
    await adapter.getDurations("2026-08-01");
    await adapter.getSummaries("2026-08-01", "2026-08-01");
    for (const [url] of fetch.mock.calls) {
      expect(new URL(url).searchParams.get("timezone")).toBe("Asia/Seoul");
    }
  });
});

describe("WakaTimeAdapter auth", () => {
  it("sends the OAuth access token as Bearer, never Basic API-key auth", async () => {
    const fetch = vi.fn().mockImplementation(async () => json({ data: [] }));
    vi.stubGlobal("fetch", fetch);
    await new WakaTimeAdapter("waka_tok_123").getDurations("2026-08-01");
    const headers = fetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer waka_tok_123");
    expect(headers.Authorization).not.toMatch(/^Basic/);
  });

  it("maps 401 to WakaTimeAuthError (refreshable) without retrying", async () => {
    const fetch = vi.fn().mockImplementation(async () => json({ error: "Unauthorized" }, 401));
    vi.stubGlobal("fetch", fetch);
    await expect(new WakaTimeAdapter("t").getDurations("2026-08-01")).rejects.toBeInstanceOf(
      WakaTimeAuthError
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("maps 403 (e.g. the API-key rejection) to a non-auth WakaTimeApiError", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async () =>
        json({ error: "API Keys are only for plugins, use your personal oauth token" }, 403)
      );
    vi.stubGlobal("fetch", fetch);
    const err = await new WakaTimeAdapter("t")
      .getSummaries("2026-08-01", "2026-08-01")
      .catch((e) => e);
    expect(err).toBeInstanceOf(WakaTimeApiError);
    expect(err).not.toBeInstanceOf(WakaTimeAuthError);
    expect((err as WakaTimeApiError).status).toBe(403);
  });
});

describe("parseTokenResponse", () => {
  const now = Date.UTC(2026, 10, 10);

  it("derives expiry from expires_in", () => {
    const t = parseTokenResponse(
      { access_token: "a", refresh_token: "r", expires_in: 3600, uid: "u1", scope: "s" },
      now
    );
    expect(t).toEqual({
      accessToken: "a",
      refreshToken: "r",
      expiresAt: new Date(now + 3_600_000),
      scope: "s",
      wakatimeUserId: "u1",
    });
  });

  it("falls back to expires_at, then to no expiry", () => {
    expect(
      parseTokenResponse(
        { access_token: "a", refresh_token: "r", expires_at: "2126-11-10T00:00:00Z" },
        now
      ).expiresAt
    ).toEqual(new Date("2126-11-10T00:00:00Z"));
    expect(parseTokenResponse({ access_token: "a", refresh_token: "r" }, now).expiresAt).toBeNull();
  });

  it("uses a rotated refresh token when the response carries one", () => {
    expect(
      parseTokenResponse({ access_token: "a", refresh_token: "new" }, now, "old").refreshToken
    ).toBe("new");
  });

  it("preserves the stored refresh token when the response omits it", () => {
    expect(parseTokenResponse({ access_token: "a" }, now, "old").refreshToken).toBe("old");
  });

  it("rejects a response with no access token, or no refresh token on first exchange", () => {
    expect(() => parseTokenResponse({ refresh_token: "r" }, now)).toThrow(WakaTimeApiError);
    expect(() => parseTokenResponse({ access_token: "a" }, now)).toThrow(WakaTimeApiError);
  });
});

describe("WakaTimeOAuthClient", () => {
  const client = new WakaTimeOAuthClient("cid", "secret");

  it("builds a code-flow authorize URL with the scopes our reads need", () => {
    const url = new URL(client.buildAuthorizeUrl({ redirectUri: "https://app/cb", state: "st" }));
    expect(url.origin + url.pathname).toBe("https://wakatime.com/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app/cb");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("scope")?.split(",").sort()).toEqual([
      "read_heartbeats",
      "read_summaries",
    ]);
  });

  it("exchanges a code with a form-encoded POST", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async () =>
        json({ access_token: "a", refresh_token: "r", uid: "u", scope: "read_summaries" })
      );
    vi.stubGlobal("fetch", fetch);
    const tokens = await client.exchangeCode({ code: "c", redirectUri: "https://app/cb" });
    expect(tokens.accessToken).toBe("a");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(WAKATIME_TOKEN_URL);
    const body = new URLSearchParams(init.body as string);
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "authorization_code",
      code: "c",
      redirect_uri: "https://app/cb",
      client_id: "cid",
      client_secret: "secret",
    });
  });

  it("refresh preserves the stored refresh token when none is returned", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => json({ access_token: "a2" }))
    );
    const t = await client.refreshToken({ refreshToken: "keep", redirectUri: "https://app/cb" });
    expect(t).toMatchObject({ accessToken: "a2", refreshToken: "keep" });
  });

  it("refresh throws WakaTimeAuthError only on invalid_grant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => json({ error: "invalid_grant" }, 400))
    );
    await expect(
      client.refreshToken({ refreshToken: "r", redirectUri: "https://app/cb" })
    ).rejects.toBeInstanceOf(WakaTimeAuthError);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => json({ error: "invalid_client" }, 401))
    );
    const err = await client
      .refreshToken({ refreshToken: "r", redirectUri: "https://app/cb" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(WakaTimeApiError);
    expect(err).not.toBeInstanceOf(WakaTimeAuthError);
  });
});
