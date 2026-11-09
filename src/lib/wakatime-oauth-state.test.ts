import { describe, expect, it } from "vitest";
import {
  createOAuthState as createGoogleState,
  verifyOAuthState as verifyGoogleState,
} from "./google-oauth-state";
import { createOAuthState, verifyOAuthState } from "./wakatime-oauth-state";
import {
  createOAuthState as createWithingsState,
  verifyOAuthState as verifyWithingsState,
} from "./withings-oauth-state";

// vitest.config injects KIS_ENCRYPTION_KEY, so signing works in tests.

describe("wakatime oauth state", () => {
  it("round-trips a signed state and recovers the userId", () => {
    const uuid = "11111111-2222-3333-4444-555555555555";
    expect(verifyOAuthState(createOAuthState(uuid))).toEqual({ userId: uuid });
  });

  it("rejects tampered, expired and malformed states", () => {
    const state = createOAuthState("user-abc");
    expect(verifyOAuthState(`${state.slice(0, -2)}xy`)).toBeNull();
    expect(verifyOAuthState(createOAuthState("user-abc", -1000))).toBeNull();
    expect(verifyOAuthState(null)).toBeNull();
    expect(verifyOAuthState("nodothere")).toBeNull();
  });

  it("does NOT verify Withings or Google Health states (distinct signing context)", () => {
    expect(verifyOAuthState(createWithingsState("user-abc"))).toBeNull();
    expect(verifyOAuthState(createGoogleState("user-abc"))).toBeNull();
  });

  it("is never accepted by the Withings or Google Health callbacks", () => {
    const state = createOAuthState("user-abc");
    expect(verifyWithingsState(state)).toBeNull();
    expect(verifyGoogleState(state)).toBeNull();
  });
});
