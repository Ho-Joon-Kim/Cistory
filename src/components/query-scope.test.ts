import { describe, expect, it } from "vitest";
import { INITIAL_QUERY_SCOPE, nextQueryScope } from "./query-scope";

describe("nextQueryScope", () => {
  it("keeps the cache while the first session request is pending", () => {
    expect(nextQueryScope(INITIAL_QUERY_SCOPE, undefined)).toBe(INITIAL_QUERY_SCOPE);
  });

  it("adopts the first settled identity without replacing the cache", () => {
    expect(nextQueryScope(INITIAL_QUERY_SCOPE, "s1")).toEqual({ identity: "s1", generation: 0 });
    expect(nextQueryScope(INITIAL_QUERY_SCOPE, "anonymous").generation).toBe(0);
  });

  it("replaces the cache at every later authentication boundary", () => {
    const signedIn = nextQueryScope(INITIAL_QUERY_SCOPE, "s1");
    const signedOut = nextQueryScope(signedIn, "anonymous");
    expect(signedOut.generation).toBe(1);
    const again = nextQueryScope(signedOut, "s2");
    expect(again.generation).toBe(2);
    // A new session for the same user is still a new scope.
    expect(nextQueryScope(again, "s3").generation).toBe(3);
  });

  it("ignores repeat renders and refetches of the same identity", () => {
    const scope = nextQueryScope(INITIAL_QUERY_SCOPE, "s1");
    expect(nextQueryScope(scope, "s1")).toBe(scope);
    expect(nextQueryScope(scope, undefined)).toBe(scope);
  });
});
