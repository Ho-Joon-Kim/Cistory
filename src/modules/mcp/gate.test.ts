import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import {
  evaluateLock,
  isAllowedOrigin,
  limitTokenRequest,
  limitUnauthenticatedRequest,
  rateLimitedResponse,
  readClientLocation,
} from "./gate";

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

function request(values: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://cistory.example/api/mcp", { method: "POST", headers: values });
}

describe("readClientLocation", () => {
  it("reads and normalizes the Cloudflare headers", () => {
    expect(
      readClientLocation(
        headers({ "cf-connecting-ip": "::ffff:192.168.0.10", "cf-ipcountry": "kr" })
      )
    ).toEqual({ ip: "192.168.0.10", country: "KR" });
  });

  it.each(["XX", "T1", "", "ZZ", "korea"])("treats country %j as unknown", (value) => {
    expect(readClientLocation(headers({ "cf-ipcountry": value })).country).toBeNull();
  });

  it("ignores X-Forwarded-For entirely", () => {
    expect(readClientLocation(headers({ "x-forwarded-for": "1.2.3.4" }))).toEqual({
      ip: null,
      country: null,
    });
  });

  it("treats an unparseable CF-Connecting-IP as unknown", () => {
    expect(readClientLocation(headers({ "cf-connecting-ip": "not-an-ip" })).ip).toBeNull();
  });
});

describe("evaluateLock", () => {
  const none = { cidrs: [], countries: [] };
  const cidrOnly = { cidrs: ["192.168.0.0/24"], countries: [] };
  const countryOnly = { cidrs: [], countries: ["KR"] };
  const both = { cidrs: ["192.168.0.0/24"], countries: ["KR"] };

  it("passes everything when there is no lock", () => {
    expect(evaluateLock(none, { ip: null, country: null })).toEqual({ allowed: true });
  });

  it("AE3: a CIDR-only token passes with no country header when the IP is in range", () => {
    expect(evaluateLock(cidrOnly, { ip: "192.168.0.10", country: null })).toEqual({
      allowed: true,
    });
  });

  it("AE3: a country-locked token rejects XX and T1 as country_unknown", () => {
    for (const value of ["XX", "T1"]) {
      const location = readClientLocation(headers({ "cf-ipcountry": value }));
      expect(evaluateLock(countryOnly, location)).toEqual({
        allowed: false,
        reason: "country_unknown",
      });
    }
  });

  it("matches ::ffff:-mapped clients against IPv4 locks", () => {
    const location = readClientLocation(headers({ "cf-connecting-ip": "::ffff:192.168.0.10" }));
    expect(evaluateLock(cidrOnly, location)).toEqual({ allowed: true });
  });

  it("matches inside an IPv6 /64 and rejects outside", () => {
    const lock = { cidrs: ["2001:db8:1:2::/64"], countries: [] };
    expect(evaluateLock(lock, { ip: "2001:db8:1:2::99", country: null })).toEqual({
      allowed: true,
    });
    expect(evaluateLock(lock, { ip: "2001:db8:1:3::99", country: null })).toEqual({
      allowed: false,
      reason: "ip_not_allowed",
    });
  });

  it("rejects an unknown IP under a CIDR lock", () => {
    expect(evaluateLock(cidrOnly, { ip: null, country: "KR" })).toEqual({
      allowed: false,
      reason: "ip_unknown",
    });
  });

  it("rejects a listed IP from an unlisted country when both locks apply", () => {
    expect(evaluateLock(both, { ip: "192.168.0.10", country: "JP" })).toEqual({
      allowed: false,
      reason: "country_not_allowed",
    });
    expect(evaluateLock(both, { ip: "10.0.0.1", country: "KR" })).toEqual({
      allowed: false,
      reason: "ip_not_allowed",
    });
    expect(evaluateLock(both, { ip: "192.168.0.10", country: "KR" })).toEqual({ allowed: true });
  });
});

describe("rate limits", () => {
  it("answers the 61st call on a token with 429 and Retry-After", async () => {
    const tokenId = randomUUID();
    for (let i = 0; i < 60; i++) {
      expect(limitTokenRequest(request(), tokenId)).toEqual({ allowed: true });
    }
    const denied = limitTokenRequest(request(), tokenId);
    expect(denied.allowed).toBe(false);
    if (denied.allowed) return;
    expect(denied.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(denied.retryAfterSec).toBeLessThanOrEqual(60);
    const response = rateLimitedResponse(denied.retryAfterSec);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe(String(denied.retryAfterSec));
  });

  it("keys the token bucket by token, not by the (shared) forwarded address", () => {
    const shared = { "x-forwarded-for": "172.17.0.1" };
    const a = randomUUID();
    for (let i = 0; i < 60; i++) limitTokenRequest(request(shared), a);
    expect(limitTokenRequest(request(shared), a).allowed).toBe(false);
    expect(limitTokenRequest(request(shared), randomUUID()).allowed).toBe(true);
  });

  it("counts unauthenticated failures per CF-Connecting-IP even behind one tunnel address", () => {
    const ipA = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const ipB = `2001:db8::${randomUUID().slice(0, 4)}`;
    const tunnel = { "x-forwarded-for": "172.17.0.1" };
    const reqA = request({ ...tunnel, "cf-connecting-ip": ipA });
    const reqB = request({ ...tunnel, "cf-connecting-ip": ipB });
    for (let i = 0; i < 60; i++) {
      expect(limitUnauthenticatedRequest(reqA, readClientLocation(reqA.headers)).allowed).toBe(
        true
      );
    }
    expect(limitUnauthenticatedRequest(reqA, readClientLocation(reqA.headers)).allowed).toBe(false);
    expect(limitUnauthenticatedRequest(reqB, readClientLocation(reqB.headers)).allowed).toBe(true);
  });
});

describe("isAllowedOrigin", () => {
  const allowed = ["https://cistory.example"];

  it("passes non-browser requests with no Origin", () => {
    expect(isAllowedOrigin(null, allowed)).toBe(true);
  });

  it("passes the app's own origin and rejects others", () => {
    expect(isAllowedOrigin("https://cistory.example", allowed)).toBe(true);
    expect(isAllowedOrigin("https://evil.example", allowed)).toBe(false);
    expect(isAllowedOrigin("https://cistory.example.evil.example", allowed)).toBe(false);
    expect(isAllowedOrigin("null", allowed)).toBe(false);
  });
});
