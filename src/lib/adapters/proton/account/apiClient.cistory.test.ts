import { describe, expect, it, vi } from "vitest";
import { PROTON_APP_VERSION } from "../constants";
import { ApiClient } from "./apiClient";
import type { SessionCredentials, SessionInfo } from "./sessionCredentials";

const quiet = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function fakeCredentials(initial: { accessToken: string }) {
  let accessToken = initial.accessToken;
  let refreshToken: string | undefined = "r1";
  const setSessionInfo = vi.fn(async (info: SessionInfo) => {
    accessToken = info.accessToken;
    refreshToken = info.refreshToken;
  });
  const signOut = vi.fn(async () => {});
  const credentials = {
    uid: "u",
    get accessToken() {
      return accessToken;
    },
    get refreshToken() {
      return refreshToken;
    },
    on: () => {},
    isLoggedIn: () => true,
    isTelemetryEnabled: () => false,
    getUserKeyPassword: () => undefined,
    load: async () => {},
    setUserKeyPassword: async () => {},
    setSessionInfo,
    setTelemetryEnabled: async () => {},
    signOut,
  } satisfies SessionCredentials;
  return credentials;
}

function makeClient(
  credentials: SessionCredentials,
  refreshSession: (t: string | undefined) => Promise<SessionInfo | null>
) {
  return new ApiClient({
    baseUrl: "https://api.test",
    appVersion: PROTON_APP_VERSION,
    credentials,
    logger: quiet,
    refreshSession,
  });
}

describe("ApiClient refreshSession seam", () => {
  it("delegates a 401 refresh to the injected refreshSession and never signs out on 4xx", async () => {
    const credentials = fakeCredentials({ accessToken: "old" });
    const refreshSession = vi.fn(async () => null);
    const client = makeClient(credentials, refreshSession);

    expect(await client.refreshSessionIfPossible("old")).toBe(false);
    expect(refreshSession).toHaveBeenCalledWith("old");
    expect(credentials.signOut).not.toHaveBeenCalled();
  });

  it("applies the refreshed session to credentials and reports success", async () => {
    const credentials = fakeCredentials({ accessToken: "old" });
    const refreshSession = vi.fn(async () => ({
      uid: "u",
      accessToken: "new",
      refreshToken: "r2",
    }));
    const client = makeClient(credentials, refreshSession);

    expect(await client.refreshSessionIfPossible("old")).toBe(true);
    expect(credentials.setSessionInfo).toHaveBeenCalledWith({
      uid: "u",
      accessToken: "new",
      refreshToken: "r2",
    });
  });

  it("does not call the refresher when another request already refreshed the token", async () => {
    const credentials = fakeCredentials({ accessToken: "newer" });
    const refreshSession = vi.fn(async () => null);
    const client = makeClient(credentials, refreshSession);

    expect(await client.refreshSessionIfPossible("old")).toBe(true);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("shares one refresher call between concurrent refreshes", async () => {
    const credentials = fakeCredentials({ accessToken: "old" });
    const refreshSession = vi.fn(async () => ({ uid: "u", accessToken: "new" }));
    const client = makeClient(credentials, refreshSession);

    const results = await Promise.all([
      client.refreshSessionIfPossible("old"),
      client.refreshSessionIfPossible("old"),
    ]);
    expect(results).toEqual([true, true]);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });
});
