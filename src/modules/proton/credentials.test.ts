import { describe, expect, it, vi } from "vitest";
import type { ProtonConnection } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { DbSessionCredentials } from "./credentials";

function row(over: Partial<ProtonConnection> = {}): ProtonConnection {
  return {
    id: "c",
    userId: "u",
    uidEnc: encryptSecret("U1"),
    accessTokenEnc: encryptSecret("A1"),
    refreshTokenEnc: encryptSecret("R1"),
    keyPasswordEnc: encryptSecret("KP"),
    status: "active",
    pendingForkSelector: null,
    pendingForkKeyEnc: null,
    pendingForkExpiresAt: null,
    volumeId: null,
    eventCursor: null,
    timelineListedAt: null,
    backfillCompletedAt: null,
    lastSyncedAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

describe("DbSessionCredentials", () => {
  it("decrypts uid/access/refresh/keyPassword from the row", () => {
    const creds = DbSessionCredentials.fromConnection(row());
    expect(creds.uid).toBe("U1");
    expect(creds.accessToken).toBe("A1");
    expect(creds.refreshToken).toBe("R1");
    expect(creds.getUserKeyPassword()).toBe("KP");
    expect(creds.isLoggedIn()).toBe(true);
    expect(creds.isTelemetryEnabled()).toBe(false);
  });

  it("treats a tokenless row as logged out", () => {
    const creds = DbSessionCredentials.fromConnection(
      row({ uidEnc: null, accessTokenEnc: null, refreshTokenEnc: null, keyPasswordEnc: null })
    );
    expect(creds.accessToken).toBeUndefined();
    expect(creds.getUserKeyPassword()).toBeUndefined();
    expect(creds.isLoggedIn()).toBe(false);
  });

  it("setSessionInfo updates memory, keeps refresh token when omitted, and fires sessionInfoChanged", async () => {
    const creds = DbSessionCredentials.fromConnection(row());
    const listener = vi.fn();
    creds.on("sessionInfoChanged", listener);

    await creds.setSessionInfo({ uid: "U2", accessToken: "A2" });
    expect(creds.uid).toBe("U2");
    expect(creds.accessToken).toBe("A2");
    expect(creds.refreshToken).toBe("R1");
    expect(listener).toHaveBeenCalledTimes(1);

    await creds.setSessionInfo({ uid: "U2", accessToken: "A3", refreshToken: "R3" });
    expect(creds.refreshToken).toBe("R3");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("signOut clears memory only", async () => {
    const source = row();
    const snapshot = { ...source };
    const creds = DbSessionCredentials.fromConnection(source);
    await creds.signOut();
    expect(creds.uid).toBeUndefined();
    expect(creds.accessToken).toBeUndefined();
    expect(creds.refreshToken).toBeUndefined();
    expect(creds.getUserKeyPassword()).toBeUndefined();
    expect(creds.isLoggedIn()).toBe(false);
    expect(source).toEqual(snapshot);
  });
});
