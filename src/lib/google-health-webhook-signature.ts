/**
 * Verification of Google Health API webhook signatures
 * (`GOOGLE-HEALTH-API-SIGNATURE`) with Node's built-in crypto.
 *
 * Google signs the RAW request body with Tink `PublicKeySign` (ECDSA P-256 +
 * SHA-256) and publishes the public keyset at GOOGLE_HEALTH_KEYSET_URL; keys
 * rotate every 30 days. There is no Tink for Node, so this reimplements the
 * small slice of Tink a verifier needs:
 *
 *   keyset JSON  { primaryKeyId, key: [{ keyData: { typeUrl, value: <b64 proto>,
 *                  keyMaterialType }, status, keyId, outputPrefixType }] }
 *   EcdsaPublicKey proto:  1 version, 2 params (EcdsaParams), 3 x, 4 y
 *   EcdsaParams proto:     1 hash_type (3 = SHA256), 2 curve (2 = NIST_P256),
 *                          3 encoding (1 = IEEE_P1363, 2 = DER)
 *   signature (TINK):      0x01 ‖ keyId (4 bytes, big-endian) ‖ ECDSA signature
 *   signature (LEGACY):    0x00 ‖ keyId ‖ sig over (message ‖ 0x00)
 *
 * The live keyset (checked 2026-11-10) is 5 ENABLED TINK keys, params
 * SHA256 / P-256 / DER, with x and y as 33-byte big-endian integers (a leading
 * 0x00 sign byte). Cross-checked against the reference parser in
 * github.com/msavas2544/google-health (src/google_health/webhooks.py).
 *
 * Pure functions (parseKeyset / verifySignature) are separated from the
 * fetching cache (GoogleHealthKeysetVerifier) so tests can drive both with a
 * locally generated key packaged in the same proto format.
 */

import { createPublicKey, type KeyObject, verify } from "node:crypto";

export const GOOGLE_HEALTH_KEYSET_URL =
  "https://www.gstatic.com/googlehealthapi/webhooks/webhooks_public_keyset.json";
export const GOOGLE_HEALTH_SIGNATURE_HEADER = "google-health-api-signature";

const TINK_START_BYTE = 0x01;
const LEGACY_START_BYTE = 0x00;
const PREFIX_LENGTH = 5;

type ProtoValue = number | Buffer;

/** Cursor over a protobuf buffer. */
class ProtoReader {
  i = 0;
  constructor(private readonly buf: Buffer) {}

  get done(): boolean {
    return this.i >= this.buf.length;
  }

  varint(): number {
    let result = 0;
    let factor = 1;
    for (;;) {
      if (this.i >= this.buf.length) throw new Error("truncated protobuf varint");
      const byte = this.buf[this.i++];
      result += (byte & 0x7f) * factor;
      if ((byte & 0x80) === 0) return result;
      factor *= 128;
      if (factor > 2 ** 63) throw new Error("protobuf varint too long");
    }
  }

  take(len: number): Buffer {
    if (this.i + len > this.buf.length) throw new Error("truncated protobuf bytes");
    const out = this.buf.subarray(this.i, this.i + len);
    this.i += len;
    return out;
  }

  value(wireType: number): ProtoValue {
    switch (wireType) {
      case 0:
        return this.varint();
      case 2:
        return this.take(this.varint());
      case 5:
        return this.take(4).readUInt32LE(0);
      case 1:
        return Number(this.take(8).readBigUInt64LE(0));
      default:
        throw new Error(`unsupported protobuf wire type ${wireType}`);
    }
  }
}

/** Minimal protobuf wire-format reader: field number → values, in order. */
export function readProtoFields(buf: Buffer): Map<number, ProtoValue[]> {
  const out = new Map<number, ProtoValue[]>();
  const reader = new ProtoReader(buf);
  while (!reader.done) {
    const tag = reader.varint();
    const field = Math.floor(tag / 8);
    const list = out.get(field) ?? [];
    list.push(reader.value(tag & 7));
    out.set(field, list);
  }
  return out;
}

const HASHES: Record<number, string> = { 1: "sha1", 2: "sha384", 3: "sha256", 4: "sha512" };
const CURVES: Record<number, { crv: string; size: number }> = {
  2: { crv: "P-256", size: 32 },
  3: { crv: "P-384", size: 48 },
  4: { crv: "P-521", size: 66 },
};
const ENCODINGS: Record<number, "ieee-p1363" | "der"> = { 1: "ieee-p1363", 2: "der" };

export interface VerificationKey {
  keyId: number;
  prefix: "TINK" | "LEGACY" | "RAW";
  key: KeyObject;
  hash: string;
  dsaEncoding: "ieee-p1363" | "der";
}

/** Big-endian unsigned integer bytes → exactly `size` bytes (strip sign byte, left-pad). */
function fixedWidth(bytes: Buffer, size: number): Buffer {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0 && bytes.length - start > size) start++;
  const trimmed = bytes.subarray(start);
  if (trimmed.length > size) throw new Error("EC coordinate too long");
  return Buffer.concat([Buffer.alloc(size - trimmed.length), trimmed]);
}

function bytesField(fields: Map<number, ProtoValue[]>, n: number): Buffer | null {
  const v = fields.get(n)?.[0];
  return Buffer.isBuffer(v) ? v : null;
}

function numberField(fields: Map<number, ProtoValue[]>, n: number, fallback: number): number {
  const v = fields.get(n)?.[0];
  return typeof v === "number" ? v : fallback;
}

/** Parse one keyset entry into a verification key, or null if unusable/disabled. */
function parseKeyEntry(entry: unknown): VerificationKey | null {
  const e = entry as {
    keyData?: { typeUrl?: unknown; value?: unknown };
    status?: unknown;
    keyId?: unknown;
    outputPrefixType?: unknown;
  };
  if ((e.status ?? "ENABLED") !== "ENABLED") return null;
  if (typeof e.keyData?.typeUrl !== "string" || !e.keyData.typeUrl.endsWith("EcdsaPublicKey"))
    return null;
  if (typeof e.keyData.value !== "string") return null;
  const keyId = typeof e.keyId === "number" ? e.keyId : Number(e.keyId);
  if (!Number.isInteger(keyId) || keyId < 0 || keyId > 0xffffffff) return null;
  const prefix = (e.outputPrefixType ?? "TINK") as VerificationKey["prefix"];
  if (!["TINK", "LEGACY", "RAW"].includes(prefix)) return null;

  const fields = readProtoFields(Buffer.from(e.keyData.value, "base64"));
  const paramsBytes = bytesField(fields, 2);
  const params = paramsBytes ? readProtoFields(paramsBytes) : new Map<number, ProtoValue[]>();
  const hash = HASHES[numberField(params, 1, 3)];
  const curve = CURVES[numberField(params, 2, 2)];
  const dsaEncoding = ENCODINGS[numberField(params, 3, 2)];
  const x = bytesField(fields, 3);
  const y = bytesField(fields, 4);
  if (!hash || !curve || !dsaEncoding || !x || !y) return null;

  // createPublicKey validates the point is on the curve.
  const key = createPublicKey({
    key: {
      kty: "EC",
      crv: curve.crv,
      x: fixedWidth(x, curve.size).toString("base64url"),
      y: fixedWidth(y, curve.size).toString("base64url"),
    },
    format: "jwk",
  });
  return { keyId, prefix, key, hash, dsaEncoding };
}

/** Parse a Tink JSON public keyset. Unusable entries are skipped; none usable throws. */
export function parseKeyset(json: unknown): VerificationKey[] {
  const entries = (json as { key?: unknown[] } | null)?.key;
  if (!Array.isArray(entries)) throw new Error("keyset has no key array");
  const keys: VerificationKey[] = [];
  for (const entry of entries) {
    try {
      const key = parseKeyEntry(entry);
      if (key) keys.push(key);
    } catch {
      // One malformed entry must not take down verification with the others.
    }
  }
  if (keys.length === 0) throw new Error("keyset contains no usable ECDSA keys");
  return keys;
}

export type SignatureFailure =
  | "missing_signature"
  | "malformed_signature"
  | "unknown_key"
  | "invalid_signature";

export type SignatureResult = { ok: true; keyId: number } | { ok: false; reason: SignatureFailure };

/** Decode the header, rejecting anything that is not plain base64. */
function decodeSignature(header: string): Buffer | null {
  const trimmed = header.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) return null;
  const bytes = Buffer.from(trimmed.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return bytes.length > PREFIX_LENGTH ? bytes : null;
}

/**
 * Verify `signatureHeader` over the raw `body` bytes against `keys`.
 * `unknown_key` means no key's prefix matched — the caller may refetch the
 * keyset once (rotation) and retry.
 */
export function verifySignature(
  keys: VerificationKey[],
  body: Buffer,
  signatureHeader: string | null | undefined
): SignatureResult {
  if (!signatureHeader) return { ok: false, reason: "missing_signature" };
  const sig = decodeSignature(signatureHeader);
  if (!sig) return { ok: false, reason: "malformed_signature" };

  let matchedPrefix = false;
  for (const k of keys) {
    const outcome = verifyWithKey(k, body, sig);
    if (outcome === "verified") return { ok: true, keyId: k.keyId };
    if (outcome === "invalid") matchedPrefix = true;
  }
  return { ok: false, reason: matchedPrefix ? "invalid_signature" : "unknown_key" };
}

/** One key: does its output prefix match, and if so does the signature verify? */
function verifyWithKey(
  k: VerificationKey,
  body: Buffer,
  sig: Buffer
): "verified" | "invalid" | "prefix_mismatch" {
  let signature = sig;
  let message = body;
  if (k.prefix !== "RAW") {
    const start = k.prefix === "TINK" ? TINK_START_BYTE : LEGACY_START_BYTE;
    if (sig[0] !== start || sig.readUInt32BE(1) !== k.keyId) return "prefix_mismatch";
    signature = sig.subarray(PREFIX_LENGTH);
    if (k.prefix === "LEGACY") message = Buffer.concat([body, Buffer.from([0])]);
  }
  try {
    return verify(k.hash, message, { key: k.key, dsaEncoding: k.dsaEncoding }, signature)
      ? "verified"
      : "invalid";
  } catch {
    // Structurally invalid for this encoding (e.g. P1363 bytes against a DER key).
    return "invalid";
  }
}

/** The keyset could not be fetched/parsed and no cached copy exists. */
export class KeysetUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeysetUnavailableError";
  }
}

export type KeysetFetcher = () => Promise<unknown>;

const defaultFetcher: KeysetFetcher = async () => {
  const res = await fetch(GOOGLE_HEALTH_KEYSET_URL, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`keyset HTTP ${res.status}`);
  return res.json();
};

/**
 * In-memory keyset cache. Keys are reused for `ttlMs`; a signature whose key id
 * is unknown triggers ONE refetch (rotation), rate-limited to once per
 * `minRefetchMs` so a flood of junk signatures can't hammer gstatic. A failed
 * refresh keeps serving the cached keys; only a cold cache surfaces
 * KeysetUnavailableError (the route answers 503 so Google retries).
 */
export class GoogleHealthKeysetVerifier {
  private keys: VerificationKey[] = [];
  private fetchedAt = 0;
  private lastForcedAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly fetcher: KeysetFetcher = defaultFetcher,
    private readonly ttlMs = 6 * 3600_000,
    private readonly minRefetchMs = 60_000,
    private readonly now: () => number = Date.now
  ) {}

  private async refresh(): Promise<void> {
    if (!this.inflight) {
      this.inflight = (async () => {
        try {
          this.keys = parseKeyset(await this.fetcher());
          this.fetchedAt = this.now();
        } catch (err) {
          if (this.keys.length === 0) {
            throw new KeysetUnavailableError(err instanceof Error ? err.message : String(err));
          }
        }
      })().finally(() => {
        this.inflight = null;
      });
    }
    await this.inflight;
  }

  async verify(body: Buffer, signatureHeader: string | null | undefined): Promise<SignatureResult> {
    if (this.keys.length === 0 || this.now() - this.fetchedAt > this.ttlMs) await this.refresh();
    let result = verifySignature(this.keys, body, signatureHeader);
    if (
      !result.ok &&
      result.reason === "unknown_key" &&
      this.now() - this.lastForcedAt >= this.minRefetchMs
    ) {
      this.lastForcedAt = this.now();
      await this.refresh();
      result = verifySignature(this.keys, body, signatureHeader);
    }
    return result;
  }
}
