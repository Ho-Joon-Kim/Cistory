import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import type { WakaTimeConnection } from "@/db/schema";
import {
  WakaTimeApiError,
  WakaTimeAuthError,
  type WakaTimeOAuthClient,
} from "@/lib/adapters/wakatime/wakatime";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { isWakaTimeTokenFresh, WakaTimeConnectionService } from "./connection";

function connection(over: Partial<WakaTimeConnection> = {}): WakaTimeConnection {
  return {
    id: "c",
    userId: "u",
    wakatimeUserId: "w",
    accessTokenEnc: encryptSecret("old-access"),
    refreshTokenEnc: encryptSecret("refresh-1"),
    accessTokenExpiresAt: null,
    scope: "read_summaries,read_heartbeats",
    status: "active",
    lastSyncError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function fakeDb(row: WakaTimeConnection) {
  const updates: Record<string, unknown>[] = [];
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        updates.push(v);
        return { where: async () => undefined };
      },
    }),
    delete: () => ({ where: async () => undefined }),
    execute: async () => undefined,
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  return { db: db as unknown as Database, updates };
}

function oauth(refreshToken: WakaTimeOAuthClient["refreshToken"]) {
  const client = { refreshToken: vi.fn(refreshToken), revokeToken: vi.fn(async () => {}) };
  return { client, factory: () => client as unknown as WakaTimeOAuthClient };
}

const reauthUpdates = (updates: Record<string, unknown>[]) =>
  updates.filter((u) => u.status === "needs_reauth");

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://cistory.test"));
afterEach(() => vi.unstubAllEnvs());

describe("isWakaTimeTokenFresh", () => {
  it("treats a missing expiry (100-year code-flow token) as fresh", () => {
    expect(isWakaTimeTokenFresh(null, 1000)).toBe(true);
  });
  it("is stale inside the grace window", () => {
    expect(isWakaTimeTokenFresh(new Date(1000 + 30_000), 1000, 60_000)).toBe(false);
  });
});

describe("WakaTimeConnectionService.withToken", () => {
  it("uses the stored token without refreshing when it works", async () => {
    const { db, updates } = fakeDb(connection());
    const { client, factory } = oauth(async () => {
      throw new Error("should not refresh");
    });
    const svc = new WakaTimeConnectionService(db, factory);
    expect(await svc.withToken(connection(), async (t) => t)).toBe("old-access");
    expect(client.refreshToken).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("refreshes once on 401, persists the rotated token, and retries", async () => {
    const row = connection();
    const { db, updates } = fakeDb(row);
    const { client, factory } = oauth(async () => ({
      accessToken: "new-access",
      refreshToken: "refresh-2",
      expiresAt: null,
      scope: null,
      wakatimeUserId: null,
    }));
    const svc = new WakaTimeConnectionService(db, factory);
    const call = vi.fn(async (t: string) => {
      if (t === "old-access") throw new WakaTimeAuthError("unauthorized", 401);
      return "data";
    });
    expect(await svc.withToken(row, call)).toBe("data");
    expect(client.refreshToken).toHaveBeenCalledWith({
      refreshToken: "refresh-1",
      redirectUri: "https://cistory.test/api/wakatime/callback",
    });
    expect(updates).toHaveLength(1);
    expect(decryptSecret(updates[0].refreshTokenEnc as string)).toBe("refresh-2");
    expect(decryptSecret(updates[0].accessTokenEnc as string)).toBe("new-access");
    expect(updates[0].status).toBe("active");
    expect(reauthUpdates(updates)).toEqual([]);
  });

  it("marks needs_reauth when a freshly refreshed token is still rejected", async () => {
    const row = connection();
    const { db, updates } = fakeDb(row);
    const { factory } = oauth(async () => ({
      accessToken: "new-access",
      refreshToken: "refresh-1",
      expiresAt: null,
      scope: null,
      wakatimeUserId: null,
    }));
    const svc = new WakaTimeConnectionService(db, factory);
    await expect(
      svc.withToken(row, async () => {
        throw new WakaTimeAuthError("unauthorized", 401);
      })
    ).rejects.toBeInstanceOf(WakaTimeAuthError);
    expect(reauthUpdates(updates)).toHaveLength(1);
  });

  it("does NOT mark needs_reauth on a 403/5xx data error", async () => {
    const row = connection();
    const { db, updates } = fakeDb(row);
    const { client, factory } = oauth(async () => {
      throw new Error("unused");
    });
    const svc = new WakaTimeConnectionService(db, factory);
    await expect(
      svc.withToken(row, async () => {
        throw new WakaTimeApiError("forbidden", 403);
      })
    ).rejects.toBeInstanceOf(WakaTimeApiError);
    expect(client.refreshToken).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });
});

describe("WakaTimeConnectionService.getValidToken", () => {
  const expired = () => connection({ accessTokenExpiresAt: new Date(Date.now() - 1000) });

  it("marks needs_reauth on a confirmed invalid_grant refresh failure", async () => {
    const row = expired();
    const { db, updates } = fakeDb(row);
    const { factory } = oauth(async () => {
      throw new WakaTimeAuthError("invalid_grant", 400);
    });
    await expect(new WakaTimeConnectionService(db, factory).getValidToken(row)).rejects.toThrow(
      "invalid_grant"
    );
    expect(reauthUpdates(updates)).toHaveLength(1);
  });

  it("leaves the connection active on a transient refresh failure", async () => {
    const row = expired();
    const { db, updates } = fakeDb(row);
    const { factory } = oauth(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(new WakaTimeConnectionService(db, factory).getValidToken(row)).rejects.toThrow(
      "fetch failed"
    );
    expect(updates).toEqual([]);
  });

  it("leaves the connection active on a non-invalid_grant token error", async () => {
    const row = expired();
    const { db, updates } = fakeDb(row);
    const { factory } = oauth(async () => {
      throw new WakaTimeApiError("invalid_client", 401);
    });
    await expect(new WakaTimeConnectionService(db, factory).getValidToken(row)).rejects.toThrow();
    expect(updates).toEqual([]);
  });
});

describe("WakaTimeConnectionService.disconnect", () => {
  it("deletes the row even when revoke fails", async () => {
    const row = connection();
    const { db } = fakeDb(row);
    const del = vi.spyOn(db, "delete");
    const client = {
      revokeToken: vi.fn(async () => {
        throw new Error("network");
      }),
    };
    await new WakaTimeConnectionService(
      db,
      () => client as unknown as WakaTimeOAuthClient
    ).disconnect("u");
    expect(client.revokeToken).toHaveBeenCalledWith("old-access");
    expect(client.revokeToken).toHaveBeenCalledWith("refresh-1");
    expect(del).toHaveBeenCalled();
  });
});
