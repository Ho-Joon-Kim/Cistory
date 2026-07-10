import { describe, expect, it } from "vitest";
import { createOAuthState, verifyOAuthState } from "./withings-oauth-state";

// vitest.config injects KIS_ENCRYPTION_KEY, so signing works in tests.

describe("withings oauth state", () => {
  it("round-trips a signed state and recovers the userId", () => {
    const state = createOAuthState("user-abc");
    expect(verifyOAuthState(state)).toEqual({ userId: "user-abc" });
  });

  it("preserves userIds that contain hyphens (UUIDs)", () => {
    const uuid = "11111111-2222-3333-4444-555555555555";
    const state = createOAuthState(uuid);
    expect(verifyOAuthState(state)?.userId).toBe(uuid);
  });

  it("rejects a tampered payload", () => {
    const state = createOAuthState("user-abc");
    const tampered = `${state.slice(0, -2)}xy`;
    expect(verifyOAuthState(tampered)).toBeNull();
  });

  it("rejects a state whose payload was swapped for another user", () => {
    const other = createOAuthState("attacker");
    const mine = createOAuthState("victim");
    const forged = `${other.split(".")[0]}.${mine.split(".")[1]}`;
    expect(verifyOAuthState(forged)).toBeNull();
  });

  it("rejects an expired state", () => {
    const state = createOAuthState("user-abc", -1000);
    expect(verifyOAuthState(state)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(verifyOAuthState(null)).toBeNull();
    expect(verifyOAuthState("")).toBeNull();
    expect(verifyOAuthState("nodothere")).toBeNull();
  });
});
