import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import type { ProtonConnection } from "@/db/schema";
import type { SessionInfo } from "@/lib/adapters/proton/account";

const m = vi.hoisted(() => ({
  refresh: vi.fn(),
  refreshSession: null as null | ((rejected: string | undefined) => Promise<SessionInfo | null>),
}));
vi.mock("@/lib/adapters/proton/client", () => ({
  createProtonPhotosClient: async (opts: {
    refreshSession: (rejected: string | undefined) => Promise<SessionInfo | null>;
  }) => {
    m.refreshSession = opts.refreshSession;
    return {};
  },
}));
vi.mock("./credentials", () => ({ DbSessionCredentials: { fromConnection: () => ({}) } }));
vi.mock("./token", () => ({ refreshProtonSession: m.refresh }));

import { openProtonPhotos } from "./session";

const db = {} as Database;
const conn = { userId: "u1" } as ProtonConnection;

describe("openProtonPhotos session guard", () => {
  it("passes a refreshed session with the fence uid through", async () => {
    const onSessionChanged = vi.fn();
    await openProtonPhotos(db, conn, { expectedUid: "UID-1", onSessionChanged });
    m.refresh.mockResolvedValue({ uid: "UID-1", accessToken: "a2" });

    await expect(m.refreshSession?.("a1")).resolves.toEqual({ uid: "UID-1", accessToken: "a2" });
    expect(m.refresh).toHaveBeenCalledWith(db, "u1", "a1");
    expect(onSessionChanged).not.toHaveBeenCalled();
  });

  it("refuses a session with a different uid and reports it", async () => {
    const onSessionChanged = vi.fn();
    await openProtonPhotos(db, conn, { expectedUid: "UID-1", onSessionChanged });
    m.refresh.mockResolvedValue({ uid: "UID-2", accessToken: "b1" });

    await expect(m.refreshSession?.("a1")).resolves.toBeNull();
    expect(onSessionChanged).toHaveBeenCalledTimes(1);
  });

  it("without a guard returns whatever the refresher returns", async () => {
    await openProtonPhotos(db, conn);
    m.refresh.mockResolvedValue({ uid: "UID-2", accessToken: "b1" });
    await expect(m.refreshSession?.("a1")).resolves.toEqual({ uid: "UID-2", accessToken: "b1" });
  });
});
