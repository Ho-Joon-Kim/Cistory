import { createCipheriv, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pollProtonFork, startProtonFork } from "./fork";

function seal(key: Buffer, payload: object): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from("fork", "utf8"));
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([nonce, ct, cipher.getAuthTag()]).toString("base64");
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("pollProtonFork", () => {
  it("decrypts the fork payload into the key password", async () => {
    const key = randomBytes(32);
    const fetchFn = vi.fn(async () =>
      json(200, {
        Code: 1000,
        UID: "U",
        AccessToken: "A",
        RefreshToken: "R",
        Payload: seal(key, { type: "default", keyPassword: "kp" }),
      })
    );
    vi.stubGlobal("fetch", fetchFn);

    expect(await pollProtonFork("sel", key)).toEqual({
      status: "ready",
      tokens: { uid: "U", accessToken: "A", refreshToken: "R" },
      keyPassword: "kp",
    });
  });

  it("returns pending on 422", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(422, { Code: 2001, Error: "not ready" }))
    );
    expect(await pollProtonFork("sel", randomBytes(32))).toEqual({ status: "pending" });
  });

  it("rejects a payload sealed with another key (GCM auth fails)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(200, {
          Code: 1000,
          UID: "U",
          AccessToken: "A",
          RefreshToken: "R",
          Payload: seal(randomBytes(32), { keyPassword: "kp" }),
        })
      )
    );
    await expect(pollProtonFork("sel", randomBytes(32))).rejects.toThrow();
  });

  it("propagates non-422 failures instead of reporting pending", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(400, { Code: 2000 }))
    );
    await expect(pollProtonFork("sel", randomBytes(32))).rejects.toThrow();
  });
});

describe("startProtonFork", () => {
  it("builds a sign-in URL carrying external-drive and a 10-minute expiry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T00:00:00.000Z"));
    const fetchFn = vi.fn(async () => json(200, { Code: 1000, Selector: "sel-1", UserCode: "uc-1" }));
    vi.stubGlobal("fetch", fetchFn);

    const fork = await startProtonFork();

    expect(fork.selector).toBe("sel-1");
    expect(fork.encryptionKey).toHaveLength(32);
    expect(
      fork.signInUrl.startsWith("https://account.proton.me/desktop/login?app=drive&pv=3#payload=")
    ).toBe(true);
    expect(fork.signInUrl).toContain(encodeURIComponent(":external-drive"));
    expect(fork.expiresAt).toEqual(new Date("2026-11-10T00:10:00.000Z"));
  });
});
