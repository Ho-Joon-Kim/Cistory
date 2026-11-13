import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { enforceRateLimit } from "./api-auth";

function request(xff: string): NextRequest {
  return new NextRequest("https://cistory.example/api/x", { headers: { "x-forwarded-for": xff } });
}

describe("enforceRateLimit", () => {
  it("keys by the trusted X-Forwarded-For tail by default", () => {
    const bucket = `test-${randomUUID()}`;
    for (let i = 0; i < 2; i++)
      expect(enforceRateLimit(request("9.9.9.9, 1.1.1.1"), bucket, 2).allowed).toBe(true);
    // Same tail, different spoofed head: same bucket.
    expect(enforceRateLimit(request("8.8.8.8, 1.1.1.1"), bucket, 2).allowed).toBe(false);
    expect(enforceRateLimit(request("1.1.1.2"), bucket, 2).allowed).toBe(true);
  });

  it("uses an explicit clientKey instead of the IP when given", () => {
    const bucket = `test-${randomUUID()}`;
    const shared = request("172.17.0.1");
    expect(enforceRateLimit(shared, bucket, 1, "token-a").allowed).toBe(true);
    expect(enforceRateLimit(shared, bucket, 1, "token-a").allowed).toBe(false);
    expect(enforceRateLimit(shared, bucket, 1, "token-b").allowed).toBe(true);
    // The default (IP) bucket is separate from the explicit-key ones.
    expect(enforceRateLimit(shared, bucket, 1).allowed).toBe(true);
  });

  it("reports how long until the window resets", () => {
    const bucket = `test-${randomUUID()}`;
    enforceRateLimit(request("1.1.1.1"), bucket, 1);
    const denied = enforceRateLimit(request("1.1.1.1"), bucket, 1);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.retryAfterMs).toBeGreaterThan(0);
  });
});
