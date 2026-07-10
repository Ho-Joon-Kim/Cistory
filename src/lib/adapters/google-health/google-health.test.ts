import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGoogleHealthAdapter,
  GoogleHealthApiError,
  GoogleHealthAuthError,
} from "./google-health";

// The adapter calls undici's own fetch (with a family:4 dispatcher to force IPv4),
// not the global fetch, so mock the undici module rather than stubbing globalThis.
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("undici", () => ({
  Agent: class {},
  fetch: fetchMock,
}));

/** Minimal Response stand-in — the adapter reads `status`, `ok`, and `text()`. */
function resp(payload: unknown, status = 200) {
  return {
    status,
    ok: status < 400,
    text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
  } as unknown as Response;
}

/** Build an unsigned id_token JWT carrying the given sub claim. */
function idTokenWithSub(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ sub })).toString("base64url");
  return `header.${payload}.sig`;
}

// throttleMs: 0 so tests don't wait on the polite self-throttle.
const adapter = () => createGoogleHealthAdapter("client-id", "client-secret", { throttleMs: 0 });

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildAuthorizeUrl", () => {
  it("includes offline access, forced consent, joined scopes, and state", () => {
    const url = new URL(
      adapter().buildAuthorizeUrl({
        redirectUri: "https://app.example.com/api/fitbit/callback",
        state: "signed-state",
        scope: "scope-a scope-b",
      })
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toBe("scope-a scope-b");
    expect(url.searchParams.get("state")).toBe("signed-state");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/api/fitbit/callback"
    );
  });
});

describe("exchangeCode", () => {
  it("parses the token pair and the sub from the id_token", async () => {
    fetchMock.mockResolvedValueOnce(
      resp({
        access_token: "at-1",
        refresh_token: "rt-1",
        expires_in: 3600,
        scope: "openid health.read",
        id_token: idTokenWithSub("google-user-123"),
      })
    );
    const tokens = await adapter().exchangeCode({ code: "auth-code", redirectUri: "https://cb" });
    expect(tokens.accessToken).toBe("at-1");
    expect(tokens.refreshToken).toBe("rt-1");
    expect(tokens.scope).toBe("openid health.read");
    expect(tokens.googleSub).toBe("google-user-123");
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects a code exchange that returns no refresh_token", async () => {
    fetchMock.mockResolvedValueOnce(resp({ access_token: "at-1", expires_in: 3600 }));
    await expect(
      adapter().exchangeCode({ code: "auth-code", redirectUri: "https://cb" })
    ).rejects.toBeInstanceOf(GoogleHealthApiError);
  });
});

describe("refreshToken (Google non-rotation divergence from Withings)", () => {
  it("keeps the passed-in refresh token when the response omits one", async () => {
    fetchMock.mockResolvedValueOnce(
      resp({ access_token: "at-2", expires_in: 3600, scope: "health.read" })
    );
    const tokens = await adapter().refreshToken("stored-refresh-token");
    expect(tokens.accessToken).toBe("at-2");
    // The critical regression guard: Google does not rotate, so the stored token stays.
    expect(tokens.refreshToken).toBe("stored-refresh-token");
  });

  it("adopts a new refresh token on the rare occasion Google does return one", async () => {
    fetchMock.mockResolvedValueOnce(
      resp({ access_token: "at-3", refresh_token: "rotated-rt", expires_in: 3600 })
    );
    const tokens = await adapter().refreshToken("old-rt");
    expect(tokens.refreshToken).toBe("rotated-rt");
  });

  it("throws GoogleHealthAuthError (terminal, not retried) on invalid_grant", async () => {
    fetchMock.mockResolvedValueOnce(
      resp({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400)
    );
    await expect(adapter().refreshToken("dead-rt")).rejects.toBeInstanceOf(GoogleHealthAuthError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // terminal — no retry burned
  });

  it("throws GoogleHealthAuthError when the response has no access_token", async () => {
    fetchMock.mockResolvedValueOnce(resp({ expires_in: 3600 }));
    await expect(adapter().refreshToken("rt")).rejects.toBeInstanceOf(GoogleHealthAuthError);
  });
});

describe("data reads — error taxonomy", () => {
  it("maps a 401 on list to GoogleHealthAuthError (caller refreshes)", async () => {
    fetchMock.mockResolvedValueOnce(resp("unauthorized", 401));
    await expect(
      adapter().listDataPoints({ accessToken: "stale", dataType: "heart-rate" })
    ).rejects.toBeInstanceOf(GoogleHealthAuthError);
  });

  it("maps a 403 (no access / no data) to GoogleHealthApiError, not an auth error", async () => {
    fetchMock.mockResolvedValueOnce(resp("forbidden", 403));
    await expect(
      adapter().listDataPoints({ accessToken: "at", dataType: "readiness" })
    ).rejects.toBeInstanceOf(GoogleHealthApiError);
  });

  it("retries a 503 and then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(resp("upstream", 503))
      .mockResolvedValueOnce(resp({ dataPoints: [{ x: 1 }] }));
    const result = await adapter().listDataPoints({ accessToken: "at", dataType: "steps" });
    expect(result.dataPoints).toEqual([{ x: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("pagination + rollup", () => {
  it("listAllDataPoints exhausts nextPageToken across pages", async () => {
    fetchMock
      .mockResolvedValueOnce(resp({ dataPoints: [{ p: 1 }], nextPageToken: "tok-2" }))
      .mockResolvedValueOnce(resp({ dataPoints: [{ p: 2 }] }));
    const points = await adapter().listAllDataPoints({ accessToken: "at", dataType: "heart-rate" });
    expect(points).toEqual([{ p: 1 }, { p: 2 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // page 2 carried the token from page 1
    const secondCallUrl = String(fetchMock.mock.calls[1][0]);
    expect(secondCallUrl).toContain("pageToken=tok-2");
  });

  it("dailyRollUp POSTs the range + windowSizeDays and returns rollup points", async () => {
    fetchMock.mockResolvedValueOnce(resp({ rollupDataPoints: [{ day: "2026-07-01" }] }));
    const result = await adapter().dailyRollUp({
      accessToken: "at",
      dataType: "daily-resting-heart-rate",
      range: { start: { year: 2026, month: 7, day: 1 }, end: { year: 2026, month: 7, day: 7 } },
      windowSizeDays: 1,
    });
    expect(result.rollupDataPoints).toEqual([{ day: "2026-07-01" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(":dailyRollUp");
    expect((init as { method: string }).method).toBe("POST");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.range.start).toEqual({ year: 2026, month: 7, day: 1 });
    expect(body.windowSizeDays).toBe(1);
  });

  it("dailyRollUp falls back to dataPoints when rollupDataPoints is absent", async () => {
    fetchMock.mockResolvedValueOnce(resp({ dataPoints: [{ day: "2026-07-02" }] }));
    const result = await adapter().dailyRollUp({
      accessToken: "at",
      dataType: "steps",
      range: { start: { year: 2026, month: 7, day: 1 }, end: { year: 2026, month: 7, day: 7 } },
    });
    expect(result.rollupDataPoints).toEqual([{ day: "2026-07-02" }]);
  });
});

describe("revokeToken", () => {
  it("treats an already-invalid token (400) as idempotent success", async () => {
    fetchMock.mockResolvedValueOnce(resp("invalid_token", 400));
    await expect(adapter().revokeToken("some-token")).resolves.toBeUndefined();
  });
});
