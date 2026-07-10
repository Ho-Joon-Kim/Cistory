import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMeasureGroups } from "./measure-types";
import { WithingsApiError, WithingsAuthError, type WithingsMeasureGroup } from "./types";
import { createWithingsAdapter } from "./withings";

function jsonResponse(payload: unknown, status = 200) {
  return {
    status,
    ok: status < 400,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("parseMeasureGroups", () => {
  it("reconstructs value × 10^unit and maps type codes to columns", () => {
    const groups: WithingsMeasureGroup[] = [
      {
        grpid: 1,
        date: 1_700_000_000,
        category: 1,
        measures: [
          { value: 69754, type: 1, unit: -3 }, // weight → 69.754
          { value: 184, type: 6, unit: -1 }, // fat ratio → 18.4
          { value: 8, type: 170, unit: 0 }, // visceral fat → 8
        ],
      },
    ];
    const [g] = parseMeasureGroups(groups);
    expect(g.metrics.weightKg).toBeCloseTo(69.754);
    expect(g.metrics.fatRatioPct).toBeCloseTo(18.4);
    expect(g.metrics.visceralFat).toBe(8);
    expect(g.measuredAt.getTime()).toBe(1_700_000_000 * 1000);
  });

  it("keeps mapped metrics but skips unmapped codes, retaining them in raw", () => {
    const groups: WithingsMeasureGroup[] = [
      {
        grpid: 2,
        date: 1,
        category: 1,
        measures: [
          { value: 70000, type: 1, unit: -3 }, // weight (mapped)
          { value: 55, type: 91, unit: 0 }, // PWV (unmapped — Body Comp only)
        ],
      },
    ];
    const [g] = parseMeasureGroups(groups);
    expect(g.metrics.weightKg).toBeCloseTo(70);
    expect(Object.keys(g.metrics)).toHaveLength(1);
    expect(g.raw).toHaveLength(2); // raw keeps everything for provenance
  });

  it("drops groups that are not real measures (category !== 1)", () => {
    const groups: WithingsMeasureGroup[] = [
      { grpid: 3, date: 1, category: 2, measures: [{ value: 70000, type: 1, unit: -3 }] },
    ];
    expect(parseMeasureGroups(groups)).toHaveLength(0);
  });

  it("drops groups made up solely of unmapped (other-device) codes", () => {
    const groups: WithingsMeasureGroup[] = [
      { grpid: 4, date: 1, category: 1, measures: [{ value: 120, type: 10, unit: 0 }] }, // systolic BP
    ];
    expect(parseMeasureGroups(groups)).toHaveLength(0);
  });
});

describe("WithingsAdapter.buildAuthorizeUrl", () => {
  it("includes response_type, client_id, user.metrics scope, redirect_uri and state", () => {
    const adapter = createWithingsAdapter("cid", "secret");
    const url = new URL(
      adapter.buildAuthorizeUrl({ redirectUri: "https://app/cb", state: "st8", scope: undefined })
    );
    expect(url.origin + url.pathname).toBe("https://account.withings.com/oauth2_user/authorize2");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("scope")).toBe("user.metrics");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app/cb");
    expect(url.searchParams.get("state")).toBe("st8");
  });
});

describe("WithingsAdapter token exchange", () => {
  it("exchangeCode maps the token envelope to ParsedTokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 0,
        body: {
          userid: 42,
          access_token: "acc",
          refresh_token: "ref",
          scope: "user.metrics",
          expires_in: 10800,
          token_type: "Bearer",
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createWithingsAdapter("cid", "secret", { throttleMs: 0 });
    const tokens = await adapter.exchangeCode({ code: "code123", redirectUri: "https://app/cb" });

    expect(tokens.accessToken).toBe("acc");
    expect(tokens.refreshToken).toBe("ref");
    expect(tokens.withingsUserId).toBe("42");
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const sentBody = fetchMock.mock.calls[0][1].body as string;
    expect(sentBody).toContain("action=requesttoken");
    expect(sentBody).toContain("grant_type=authorization_code");
    expect(sentBody).toContain("code=code123");
  });

  it("refreshToken returns the rotated token pair", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          status: 0,
          body: {
            userid: 42,
            access_token: "acc2",
            refresh_token: "ref2",
            scope: "user.metrics",
            expires_in: 10800,
            token_type: "Bearer",
          },
        })
      )
    );
    const adapter = createWithingsAdapter("cid", "secret", { throttleMs: 0 });
    const tokens = await adapter.refreshToken("old-refresh");
    expect(tokens.accessToken).toBe("acc2");
    expect(tokens.refreshToken).toBe("ref2");
  });
});

describe("WithingsAdapter.getMeasurements", () => {
  it("follows more/offset pagination and returns the final updatetime", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          status: 0,
          body: {
            updatetime: 100,
            more: 1,
            offset: 2,
            measuregrps: [
              { grpid: 1, date: 1, category: 1, measures: [{ value: 70000, type: 1, unit: -3 }] },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 0,
          body: {
            updatetime: 200,
            more: 0,
            offset: 0,
            measuregrps: [
              { grpid: 2, date: 2, category: 1, measures: [{ value: 71000, type: 1, unit: -3 }] },
            ],
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createWithingsAdapter("cid", "secret", { throttleMs: 0 });
    const { groups, updatetime } = await adapter.getMeasurements({
      accessToken: "acc",
      lastupdate: 50,
    });

    expect(groups.map((g) => g.groupId)).toEqual([1, 2]);
    expect(updatetime).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = fetchMock.mock.calls[0][1].body as string;
    expect(firstBody).toContain("action=getmeas");
    expect(firstBody).toContain("lastupdate=50");
    expect(firstBody).toContain("category=1");
    // allow-list restricts the request to Body Smart codes (weight = 1 present)
    expect(decodeURIComponent(firstBody)).toContain("meastypes=1,");

    const secondBody = fetchMock.mock.calls[1][1].body as string;
    expect(secondBody).toContain("offset=2");
  });
});

describe("WithingsAdapter error taxonomy", () => {
  it("maps auth-family statuses to WithingsAuthError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: 401 })));
    const adapter = createWithingsAdapter("cid", "secret", { throttleMs: 0 });
    await expect(adapter.refreshToken("old")).rejects.toBeInstanceOf(WithingsAuthError);
  });

  it("maps other non-zero statuses to WithingsApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: 342 })));
    const adapter = createWithingsAdapter("cid", "secret", { throttleMs: 0 });
    await expect(
      adapter.getMeasurements({ accessToken: "acc", lastupdate: 0 })
    ).rejects.toBeInstanceOf(WithingsApiError);
  });
});
