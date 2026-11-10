import { afterEach, describe, expect, it, vi } from "vitest";
import { PROTON_APP_VERSION } from "./constants";
import { postProtonRefresh, revokeProtonSession } from "./http";

const tokens = { uid: "U1", accessToken: "A1", refreshToken: "R1" };

function json(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status });
}

function stubFetch(...responses: (Response | Error)[]) {
  const fn = vi.fn(async (..._args: Parameters<typeof fetch>) => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra fetch");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("postProtonRefresh", () => {
  it("POSTs /auth/v4/refresh with uid, app version and the refresh_token grant", async () => {
    const fetchFn = stubFetch(json(200, { UID: "U1", AccessToken: "A2", RefreshToken: "R2" }));
    await postProtonRefresh(tokens);

    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toBe("https://drive-api.proton.me/auth/v4/refresh");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-pm-uid")).toBe("U1");
    expect(headers.get("x-pm-appversion")).toBe(PROTON_APP_VERSION);
    expect(JSON.parse(String(init?.body))).toEqual({
      ResponseType: "token",
      GrantType: "refresh_token",
      RefreshToken: "R1",
    });
  });

  it("maps 200 to ok and keeps refreshToken undefined when omitted", async () => {
    stubFetch(json(200, { UID: "U1", AccessToken: "A2" }));
    expect(await postProtonRefresh(tokens)).toEqual({
      kind: "ok",
      uid: "U1",
      accessToken: "A2",
      refreshToken: undefined,
    });
  });

  it("maps 200 with a rotated refresh token to ok carrying it", async () => {
    stubFetch(json(200, { UID: "U1", AccessToken: "A2", RefreshToken: "R2" }));
    expect(await postProtonRefresh(tokens)).toMatchObject({ kind: "ok", refreshToken: "R2" });
  });

  it("falls back to the current uid when the response omits UID", async () => {
    stubFetch(json(200, { AccessToken: "A2" }));
    expect(await postProtonRefresh(tokens)).toMatchObject({ kind: "ok", uid: "U1" });
  });

  it("maps 429 to rate_limited", async () => {
    stubFetch(json(429));
    expect(await postProtonRefresh(tokens)).toEqual({ kind: "rate_limited" });
  });

  // C7: any 4xx except 429 is a rejection.
  it.each([400, 401, 403, 422])("maps %i to rejected", async (status) => {
    stubFetch(json(status));
    expect(await postProtonRefresh(tokens)).toEqual({ kind: "rejected", status });
  });

  it("maps 5xx, network errors and a malformed 200 to transient", async () => {
    stubFetch(json(503));
    expect(await postProtonRefresh(tokens)).toEqual({ kind: "transient" });
    stubFetch(new TypeError("fetch failed"));
    expect(await postProtonRefresh(tokens)).toEqual({ kind: "transient" });
    stubFetch(json(200, {}));
    expect(await postProtonRefresh(tokens)).toEqual({ kind: "transient" });
  });
});

describe("revokeProtonSession", () => {
  it("sends DELETE /auth/v4 with Bearer and x-pm-uid and returns true on 2xx", async () => {
    const fetchFn = stubFetch(json(200));
    expect(await revokeProtonSession(tokens)).toBe(true);

    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toBe("https://drive-api.proton.me/auth/v4");
    expect(init?.method).toBe("DELETE");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer A1");
    expect(headers.get("x-pm-uid")).toBe("U1");
  });

  it("refreshes once on 401 then retries with the new access token", async () => {
    const fetchFn = stubFetch(
      json(401),
      json(200, { UID: "U1", AccessToken: "A2", RefreshToken: "R2" }),
      json(200)
    );
    expect(await revokeProtonSession(tokens)).toBe(true);

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(String(fetchFn.mock.calls[1][0])).toContain("/auth/v4/refresh");
    expect(new Headers(fetchFn.mock.calls[2][1]?.headers).get("authorization")).toBe("Bearer A2");
  });

  it("returns false and never throws when both attempts fail", async () => {
    stubFetch(json(401), json(400));
    expect(await revokeProtonSession(tokens)).toBe(false);
    stubFetch(new TypeError("fetch failed"));
    expect(await revokeProtonSession(tokens)).toBe(false);
    stubFetch(json(401), json(200, { AccessToken: "A2" }), json(401));
    expect(await revokeProtonSession(tokens)).toBe(false);
  });
});
