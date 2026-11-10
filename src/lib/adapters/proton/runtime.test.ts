import { describe, expect, it } from "vitest";
import { initProtonRuntime } from "./runtime";

describe("initProtonRuntime", () => {
  it("installs the base64/hex polyfill before crypto loads", async () => {
    await initProtonRuntime();
    expect(new Uint8Array([1, 255]).toHex()).toBe("01ff");
  });

  it("round-trips a passphrase-protected key through CryptoProxy (needs toHex)", async () => {
    const { cryptoProxy } = await initProtonRuntime();
    const key = await cryptoProxy.generateKey({ userIDs: [{ name: "t", email: "t@example.com" }] });
    const armored = await cryptoProxy.exportPrivateKey({ privateKey: key, passphrase: "pw" });
    const back = await cryptoProxy.importPrivateKey({ armoredKey: armored, passphrase: "pw" });
    expect(back.getFingerprint()).toBe(key.getFingerprint());
  }, 30_000);

  it("is memoized", async () => {
    expect(await initProtonRuntime()).toBe(await initProtonRuntime());
  });
});
