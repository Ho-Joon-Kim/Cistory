/**
 * Pure IP / CIDR helpers for MCP token locks. No DB, no request objects.
 *
 * IPv4-mapped IPv6 (`::ffff:a.b.c.d`) is folded to plain IPv4 everywhere — both
 * when a CIDR is stored and when a client address is matched — so a lock on
 * `192.168.0.0/24` matches a client that arrives as `::ffff:192.168.0.10`.
 */

import { isIPv4, isIPv6 } from "node:net";

export interface ParsedIp {
  version: 4 | 6;
  bytes: Uint8Array;
}

export interface ParsedCidr extends ParsedIp {
  prefix: number;
}

function parseIpv4Bytes(value: string): Uint8Array | null {
  if (!isIPv4(value)) return null;
  return Uint8Array.from(value.split(".").map((part) => Number.parseInt(part, 10)));
}

/**
 * Split off a trailing dotted IPv4 (`::ffff:1.2.3.4`): returns the text with
 * the quad replaced by two zero groups, plus the two real 16-bit words.
 */
function splitEmbeddedIpv4(text: string): { text: string; tail: number[] } | null {
  const lastColon = text.lastIndexOf(":");
  const lastPart = text.slice(lastColon + 1);
  if (!lastPart.includes(".")) return { text, tail: [] };
  const v4 = parseIpv4Bytes(lastPart);
  if (!v4) return null;
  return {
    text: `${text.slice(0, lastColon + 1)}0:0`,
    tail: [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]],
  };
}

/** Expand `a:b::c` into exactly eight 16-bit words, or null. */
function expandIpv6Groups(text: string): number[] | null {
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (missing < 0) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...rest];
  if (groups.length !== 8) return null;
  return groups.map((group) => Number.parseInt(group || "0", 16));
}

function parseIpv6Bytes(value: string): Uint8Array | null {
  if (!isIPv6(value) || value.includes("%")) return null;
  const split = splitEmbeddedIpv4(value.toLowerCase());
  if (!split) return null;
  const words = expandIpv6Groups(split.text);
  if (!words) return null;
  if (split.tail.length === 2) {
    words[6] = split.tail[0];
    words[7] = split.tail[1];
  }
  const bytes = new Uint8Array(16);
  words.forEach((word, i) => {
    bytes[i * 2] = (word >> 8) & 0xff;
    bytes[i * 2 + 1] = word & 0xff;
  });
  return bytes;
}

function isV4Mapped(bytes: Uint8Array): boolean {
  for (let i = 0; i < 10; i++) if (bytes[i] !== 0) return false;
  return bytes[10] === 0xff && bytes[11] === 0xff;
}

/** Parse an IPv4 or IPv6 literal. IPv4-mapped IPv6 comes back as IPv4. */
export function parseIp(input: string): ParsedIp | null {
  const value = input.trim().replace(/^\[(.*)\]$/, "$1");
  const v4 = parseIpv4Bytes(value);
  if (v4) return { version: 4, bytes: v4 };
  const v6 = parseIpv6Bytes(value);
  if (!v6) return null;
  if (isV4Mapped(v6)) return { version: 4, bytes: v6.slice(12) };
  return { version: 6, bytes: v6 };
}

/** RFC 5952 text form (lower case, longest zero run compressed). */
export function formatIp(ip: ParsedIp): string {
  if (ip.version === 4) return Array.from(ip.bytes).join(".");
  const words: number[] = [];
  for (let i = 0; i < 16; i += 2) words.push((ip.bytes[i] << 8) | ip.bytes[i + 1]);
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (words[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && words[j] === 0) j++;
    if (j - i > bestLen && j - i >= 2) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = words.map((word) => word.toString(16));
  if (bestStart === -1) return hex.join(":");
  const left = hex.slice(0, bestStart).join(":");
  const right = hex.slice(bestStart + bestLen).join(":");
  return `${left}::${right}`;
}

/** Normalize an IP literal to its canonical text, or null if it isn't one. */
export function normalizeIp(input: string): string | null {
  const parsed = parseIp(input);
  return parsed ? formatIp(parsed) : null;
}

function maskBytes(bytes: Uint8Array, prefix: number): Uint8Array {
  const out = Uint8Array.from(bytes);
  for (let i = 0; i < out.length; i++) {
    const bitsBefore = i * 8;
    if (bitsBefore >= prefix) out[i] = 0;
    else if (bitsBefore + 8 > prefix) out[i] &= (0xff << (8 - (prefix - bitsBefore))) & 0xff;
  }
  return out;
}

/**
 * Parse `addr/prefix` (or a bare address = host route). Host bits are masked
 * off; an IPv4-mapped IPv6 range with prefix >= 96 folds to IPv4.
 */
export function parseCidr(input: string): ParsedCidr | null {
  const value = input.trim();
  const slash = value.indexOf("/");
  const addressPart = slash === -1 ? value : value.slice(0, slash);
  const prefixPart = slash === -1 ? null : value.slice(slash + 1);
  if (prefixPart !== null && !/^\d{1,3}$/.test(prefixPart)) return null;

  const v4 = parseIpv4Bytes(addressPart);
  if (v4) {
    const prefix = prefixPart === null ? 32 : Number(prefixPart);
    if (prefix > 32) return null;
    return { version: 4, bytes: maskBytes(v4, prefix), prefix };
  }
  const v6 = parseIpv6Bytes(addressPart);
  if (!v6) return null;
  const prefix = prefixPart === null ? 128 : Number(prefixPart);
  if (prefix > 128) return null;
  if (isV4Mapped(v6) && prefix >= 96) {
    const v4Prefix = prefix - 96;
    return { version: 4, bytes: maskBytes(v6.slice(12), v4Prefix), prefix: v4Prefix };
  }
  return { version: 6, bytes: maskBytes(v6, prefix), prefix };
}

export function formatCidr(cidr: ParsedCidr): string {
  return `${formatIp(cidr)}/${cidr.prefix}`;
}

/** Canonical `network/prefix` text, or null if the input is not a valid CIDR. */
export function normalizeCidr(input: string): string | null {
  const parsed = parseCidr(input);
  return parsed ? formatCidr(parsed) : null;
}

/** `0.0.0.0/0` and `::/0` (any /0) — stored, but not a meaningful lock. */
export function isCatchAllCidr(input: string): boolean {
  return parseCidr(input)?.prefix === 0;
}

export function cidrContains(cidr: ParsedCidr, ip: ParsedIp): boolean {
  if (cidr.version !== ip.version) return false;
  const masked = maskBytes(ip.bytes, cidr.prefix);
  for (let i = 0; i < masked.length; i++) if (masked[i] !== cidr.bytes[i]) return false;
  return true;
}

/** True when `ip` falls inside any of `cidrs` (unparseable entries never match). */
export function ipInAnyCidr(ip: string, cidrs: readonly string[]): boolean {
  const parsed = parseIp(ip);
  if (!parsed) return false;
  return cidrs.some((entry) => {
    const cidr = parseCidr(entry);
    return cidr !== null && cidrContains(cidr, parsed);
  });
}
