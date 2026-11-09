import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  GoogleHealthKeysetVerifier,
  KeysetUnavailableError,
  parseKeyset,
  readProtoFields,
  verifySignature,
} from "./google-health-webhook-signature";

// ── A locally generated P-256 key packaged exactly like Google's Tink keyset ──
function varint(n: number): Buffer {
  const out: number[] = [];
  let v = n;
  while (v >= 0x80) {
    out.push((v % 128) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return Buffer.from(out);
}
const tag = (field: number, wire: number) => varint(field * 8 + wire);
const varintField = (field: number, n: number) => Buffer.concat([tag(field, 0), varint(n)]);
const bytesField = (field: number, b: Buffer) =>
  Buffer.concat([tag(field, 2), varint(b.length), b]);

interface TestKey {
  keyId: number;
  privateKey: KeyObject;
  entry: Record<string, unknown>;
}

function makeKey(keyId: number, encoding = 2, prefix = "TINK"): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  // Tink stores x/y as big-endian two's-complement integers: a 0x00 sign byte
  // in front of the 32 coordinate bytes, exactly as in the live keyset.
  const coord = (b64: string) => Buffer.concat([Buffer.from([0]), Buffer.from(b64, "base64url")]);
  const params = Buffer.concat([varintField(1, 3), varintField(2, 2), varintField(3, encoding)]);
  const proto = Buffer.concat([
    varintField(1, 0),
    bytesField(2, params),
    bytesField(3, coord(jwk.x)),
    bytesField(4, coord(jwk.y)),
  ]);
  return {
    keyId,
    privateKey,
    entry: {
      keyData: {
        typeUrl: "type.googleapis.com/google.crypto.tink.EcdsaPublicKey",
        value: proto.toString("base64"),
        keyMaterialType: "ASYMMETRIC_PUBLIC",
      },
      status: "ENABLED",
      keyId,
      outputPrefixType: prefix,
    },
  };
}

function keyset(...keys: TestKey[]) {
  return { primaryKeyId: keys[0]?.keyId, key: keys.map((k) => k.entry) };
}

function tinkSign(key: TestKey, body: Buffer, start = 0x01): string {
  const prefix = Buffer.alloc(5);
  prefix[0] = start;
  prefix.writeUInt32BE(key.keyId, 1);
  const sig = sign("sha256", body, { key: key.privateKey, dsaEncoding: "der" });
  return Buffer.concat([prefix, sig]).toString("base64");
}

const BODY = Buffer.from('[{"data":{"version":"1","dataType":"steps","operation":"UPSERT"}}]');

describe("readProtoFields", () => {
  it("reads varint, length-delimited and nested messages", () => {
    const inner = Buffer.concat([varintField(1, 3), varintField(2, 2)]);
    const fields = readProtoFields(Buffer.concat([varintField(1, 300), bytesField(2, inner)]));
    expect(fields.get(1)).toEqual([300]);
    expect(readProtoFields(fields.get(2)?.[0] as Buffer).get(2)).toEqual([2]);
  });

  it("rejects truncated input", () => {
    expect(() => readProtoFields(Buffer.from([0x12, 0x05, 0x01]))).toThrow(/truncated/);
  });
});

describe("parseKeyset", () => {
  it("parses a Tink ECDSA keyset with 33-byte sign-padded coordinates", () => {
    const k = makeKey(2280854714); // > 2^31: keyIds are uint32
    const [parsed] = parseKeyset(keyset(k));
    expect(parsed).toMatchObject({ keyId: 2280854714, prefix: "TINK", hash: "sha256" });
    expect(parsed.dsaEncoding).toBe("der");
  });

  it("skips disabled and non-ECDSA entries, and throws when nothing is usable", () => {
    const disabled = makeKey(1);
    disabled.entry.status = "DISABLED";
    expect(() => parseKeyset(keyset(disabled))).toThrow(/no usable/);
    const good = makeKey(2);
    const other = { keyData: { typeUrl: "x.AesGcmKey", value: "AA==" }, keyId: 3 };
    expect(parseKeyset({ key: [disabled.entry, other, good.entry] }).map((k) => k.keyId)).toEqual([
      2,
    ]);
  });
});

describe("verifySignature", () => {
  const k = makeKey(1083906037);
  const keys = parseKeyset(keyset(k));

  it("accepts a valid TINK signature over the raw body", () => {
    expect(verifySignature(keys, BODY, tinkSign(k, BODY))).toEqual({
      ok: true,
      keyId: 1083906037,
    });
  });

  it("rejects a body tampered by a single byte", () => {
    const tampered = Buffer.from(BODY);
    tampered[10] ^= 0x01;
    expect(verifySignature(keys, tampered, tinkSign(k, BODY))).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
  });

  it("rejects a signature made by a different key under the same key id", () => {
    const impostor = makeKey(1083906037);
    expect(verifySignature(keys, BODY, tinkSign(impostor, BODY))).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
  });

  it("rejects a non-TINK prefix (LEGACY start byte) for a TINK key", () => {
    expect(verifySignature(keys, BODY, tinkSign(k, BODY, 0x00))).toEqual({
      ok: false,
      reason: "unknown_key",
    });
  });

  it("reports an unknown key id", () => {
    expect(verifySignature(keys, BODY, tinkSign(makeKey(42), BODY))).toEqual({
      ok: false,
      reason: "unknown_key",
    });
  });

  it("does not accept a P1363 signature for a DER key", () => {
    const prefix = Buffer.alloc(5);
    prefix[0] = 1;
    prefix.writeUInt32BE(k.keyId, 1);
    const p1363 = sign("sha256", BODY, { key: k.privateKey, dsaEncoding: "ieee-p1363" });
    const header = Buffer.concat([prefix, p1363]).toString("base64");
    expect(verifySignature(keys, BODY, header).ok).toBe(false);
  });

  it("supports a P1363-encoded key when the params say so", () => {
    const p = makeKey(7, 1);
    const prefix = Buffer.alloc(5);
    prefix[0] = 1;
    prefix.writeUInt32BE(7, 1);
    const sig = sign("sha256", BODY, { key: p.privateKey, dsaEncoding: "ieee-p1363" });
    const header = Buffer.concat([prefix, sig]).toString("base64");
    expect(verifySignature(parseKeyset(keyset(p)), BODY, header)).toEqual({ ok: true, keyId: 7 });
  });

  it("rejects a missing or malformed header", () => {
    expect(verifySignature(keys, BODY, undefined)).toEqual({
      ok: false,
      reason: "missing_signature",
    });
    expect(verifySignature(keys, BODY, "not base64 !!")).toEqual({
      ok: false,
      reason: "malformed_signature",
    });
    expect(verifySignature(keys, BODY, "AQID")).toEqual({
      ok: false,
      reason: "malformed_signature",
    });
  });
});

describe("GoogleHealthKeysetVerifier", () => {
  it("caches the keyset across verifications", async () => {
    const k = makeKey(11);
    const fetcher = vi.fn().mockResolvedValue(keyset(k));
    const v = new GoogleHealthKeysetVerifier(fetcher);
    await v.verify(BODY, tinkSign(k, BODY));
    await v.verify(BODY, tinkSign(k, BODY));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refetches once on an unknown key id (rotation) and then verifies", async () => {
    const oldKey = makeKey(21);
    const rotated = makeKey(22);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(keyset(oldKey))
      .mockResolvedValueOnce(keyset(oldKey, rotated));
    const v = new GoogleHealthKeysetVerifier(fetcher);
    expect(await v.verify(BODY, tinkSign(rotated, BODY))).toEqual({ ok: true, keyId: 22 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rate-limits forced refetches for repeated unknown key ids", async () => {
    const k = makeKey(31);
    const fetcher = vi.fn().mockResolvedValue(keyset(k));
    let now = 1_000_000;
    const v = new GoogleHealthKeysetVerifier(fetcher, 3600_000, 60_000, () => now);
    const junk = tinkSign(makeKey(99), BODY);
    await v.verify(BODY, junk); // initial fetch + one forced refetch
    await v.verify(BODY, junk); // within 60s → no refetch
    expect(fetcher).toHaveBeenCalledTimes(2);
    now += 61_000;
    await v.verify(BODY, junk);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("throws KeysetUnavailableError on a cold cache fetch failure", async () => {
    const v = new GoogleHealthKeysetVerifier(vi.fn().mockRejectedValue(new Error("offline")));
    await expect(v.verify(BODY, "AQIDBAUG")).rejects.toBeInstanceOf(KeysetUnavailableError);
  });

  it("keeps serving cached keys when a refresh fails", async () => {
    const k = makeKey(41);
    let now = 0;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(keyset(k))
      .mockRejectedValue(new Error("offline"));
    const v = new GoogleHealthKeysetVerifier(fetcher, 1000, 60_000, () => now);
    await v.verify(BODY, tinkSign(k, BODY));
    now += 5000; // TTL expired → refresh fails → cached keys still used
    expect(await v.verify(BODY, tinkSign(k, BODY))).toEqual({ ok: true, keyId: 41 });
  });
});
