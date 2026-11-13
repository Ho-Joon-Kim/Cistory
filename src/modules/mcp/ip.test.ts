import { describe, expect, it } from "vitest";
import {
  cidrContains,
  ipInAnyCidr,
  isCatchAllCidr,
  normalizeCidr,
  normalizeIp,
  parseCidr,
  parseIp,
} from "./ip";

describe("normalizeIp", () => {
  it("keeps IPv4 and compresses IPv6 per RFC 5952", () => {
    expect(normalizeIp("192.168.0.10")).toBe("192.168.0.10");
    expect(normalizeIp("2001:0DB8:0000:0000:0000:0000:0000:0001")).toBe("2001:db8::1");
    expect(normalizeIp("2001:db8:0:1:0:0:0:1")).toBe("2001:db8:0:1::1");
    expect(normalizeIp("::1")).toBe("::1");
    expect(normalizeIp("::")).toBe("::");
  });

  it("folds IPv4-mapped IPv6 to IPv4", () => {
    expect(normalizeIp("::ffff:192.168.0.10")).toBe("192.168.0.10");
    expect(normalizeIp("::ffff:c0a8:000a")).toBe("192.168.0.10");
    expect(normalizeIp("[::ffff:192.168.0.10]")).toBe("192.168.0.10");
  });

  it("rejects garbage, zone ids and out-of-range octets", () => {
    for (const bad of ["", "unknown", "256.1.1.1", "1.2.3", "fe80::1%eth0", "1::2::3", "gggg::1"]) {
      expect(normalizeIp(bad)).toBeNull();
    }
  });
});

describe("normalizeCidr", () => {
  it("masks host bits and adds a host prefix to bare addresses", () => {
    expect(normalizeCidr("10.1.2.3/8")).toBe("10.0.0.0/8");
    expect(normalizeCidr("203.0.113.7")).toBe("203.0.113.7/32");
    expect(normalizeCidr("2001:db8:1:2:3::/48")).toBe("2001:db8:1::/48");
    expect(normalizeCidr("2001:db8::1")).toBe("2001:db8::1/128");
  });

  it("folds an IPv4-mapped IPv6 range to IPv4", () => {
    expect(normalizeCidr("::ffff:192.168.0.0/120")).toBe("192.168.0.0/24");
  });

  it("rejects invalid prefixes and addresses", () => {
    for (const bad of [
      "10.0.0.0/33",
      "2001:db8::/129",
      "10.0.0.0/",
      "10.0.0.0/-1",
      "10.0.0.0/8/8",
      "x/8",
    ]) {
      expect(normalizeCidr(bad)).toBeNull();
    }
  });

  it("recognizes catch-all ranges", () => {
    expect(isCatchAllCidr("0.0.0.0/0")).toBe(true);
    expect(isCatchAllCidr("::/0")).toBe(true);
    expect(isCatchAllCidr("10.0.0.0/8")).toBe(false);
  });
});

describe("CIDR matching", () => {
  it("matches an IPv4-mapped client against an IPv4 range", () => {
    expect(ipInAnyCidr("::ffff:192.168.0.10", ["192.168.0.0/24"])).toBe(true);
  });

  it("matches inside an IPv6 /64 and rejects outside it", () => {
    expect(ipInAnyCidr("2001:db8:aa:bb:1:2:3:4", ["2001:db8:aa:bb::/64"])).toBe(true);
    expect(ipInAnyCidr("2001:db8:aa:bc::1", ["2001:db8:aa:bb::/64"])).toBe(false);
  });

  it("never matches across address families", () => {
    const v6 = parseCidr("::/0");
    const v4 = parseIp("1.2.3.4");
    expect(v6 && v4 && cidrContains(v6, v4)).toBe(false);
    expect(ipInAnyCidr("1.2.3.4", ["0.0.0.0/0"])).toBe(true);
  });

  it("treats non-octet prefixes correctly", () => {
    expect(ipInAnyCidr("10.0.0.130", ["10.0.0.128/25"])).toBe(true);
    expect(ipInAnyCidr("10.0.0.127", ["10.0.0.128/25"])).toBe(false);
  });

  it("returns false for an unparseable client ip or stored entry", () => {
    expect(ipInAnyCidr("nope", ["0.0.0.0/0"])).toBe(false);
    expect(ipInAnyCidr("1.2.3.4", ["garbage"])).toBe(false);
  });
});
