import type { CryptoApiInterface } from "@protontech/crypto";

export interface ProtonRuntime {
  cryptoProxy: CryptoApiInterface;
  srpApi: {
    getSrp: typeof import("@protontech/crypto/srp").getSrp;
    computeKeyPassword: typeof import("@protontech/crypto/srp").computeKeyPassword;
    generateKeySalt: typeof import("@protontech/crypto/srp").generateKeySalt;
    getRandomSrpVerifier: typeof import("@protontech/crypto/srp").getRandomSrpVerifier;
  };
}

let runtime: Promise<ProtonRuntime> | undefined;

/**
 * The only module allowed to value-import @protontech/crypto. Everything is a dynamic
 * import so the base64/hex polyfill is guaranteed to load first, whatever order a
 * formatter puts static imports in. No worker pool: CryptoApi runs in-process.
 */
export function initProtonRuntime(): Promise<ProtonRuntime> {
  runtime ??= (async () => {
    await import("./polyfill");
    const { CryptoProxy } = await import("@protontech/crypto");
    const { Api: CryptoApi } = await import("@protontech/crypto/proxy/endpoint/api.ts");
    const { computeKeyPassword, generateKeySalt, getRandomSrpVerifier, getSrp } = await import(
      "@protontech/crypto/srp"
    );
    CryptoApi.init({});
    CryptoProxy.setEndpoint(new CryptoApi(), (e) => e.clearKeyStore());
    return {
      cryptoProxy: CryptoProxy as unknown as CryptoApiInterface,
      srpApi: { getSrp, computeKeyPassword, generateKeySalt, getRandomSrpVerifier },
    };
  })();
  runtime.catch(() => {
    runtime = undefined;
  });
  return runtime;
}
