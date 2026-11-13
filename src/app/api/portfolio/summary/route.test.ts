import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/db/testing/mock-db";

const mocks = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: mocks.getDb,
}));

import { GET } from "./route";

beforeEach(() => {
  mocks.getAuthenticatedUser.mockResolvedValue({ user: { id: "user-1" }, error: null });
});

const call = () => GET(new NextRequest("http://localhost/api/portfolio/summary"), undefined);

describe("GET /api/portfolio/summary", () => {
  it("returns an empty shape without accounts", async () => {
    mocks.getDb.mockReturnValue(createMockDb([[]]).db);
    expect(await (await call()).json()).toEqual({
      accounts: [],
      totals: null,
      latestSnapshots: [],
      positions: [],
    });
  });

  it("pins totals, snapshots and positions; never exposes credentials", async () => {
    const fake = createMockDb([
      [
        {
          id: "a1",
          userId: "user-1",
          label: "ISA",
          cano: "12345678",
          acntPrdtCd: "01",
          accountType: "isa",
          isActive: true,
          lastSyncedAt: new Date("2026-11-12T00:00:00Z"),
          lastSyncError: null,
          appKeyEnc: "secret",
          appSecretEnc: "secret",
          accessToken: "token",
        },
      ],
      [{ accountId: "a1", maxDate: "2026-11-12" }],
      [
        {
          id: "s1",
          accountId: "a1",
          takenAt: new Date("2026-11-12T07:00:00Z"),
          asOfDate: "2026-11-12",
          totalEvalAmount: "1100000",
          securitiesEvalAmount: "1000000",
          deposit: "100000",
          totalPurchaseAmount: "900000",
          totalPnl: "100000",
          totalPnlRate: "11.1",
          realizedPnl: null,
          prevDayTotalAsset: "1000000",
          assetIcdcAmt: "100000",
        },
      ],
      [
        {
          id: "p1",
          snapshotId: "s1",
          ticker: "360750",
          name: "TIGER S&P500",
          quantity: "10",
          avgPrice: "90000",
          currentPrice: "100000",
          evalAmount: "1000000",
          pnl: "100000",
          pnlRate: null,
          weight: "1",
        },
      ],
    ]);
    mocks.getDb.mockReturnValue(fake.db);
    const body = await (await call()).json();
    expect(body).toEqual({
      accounts: [
        {
          id: "a1",
          label: "ISA",
          cano: "12345678",
          acntPrdtCd: "01",
          accountType: "isa",
          isActive: true,
          lastSyncedAt: "2026-11-12T00:00:00.000Z",
          lastSyncError: null,
        },
      ],
      totals: {
        totalEvalAmount: 1100000,
        totalDeposit: 100000,
        totalPurchaseAmount: 900000,
        totalPnl: 100000,
        totalPnlRate: (100000 / 900000) * 100,
        prevDayTotalAsset: 1000000,
        assetIcdcAmt: 100000,
      },
      latestSnapshots: [
        {
          id: "s1",
          accountId: "a1",
          takenAt: "2026-11-12T07:00:00.000Z",
          asOfDate: "2026-11-12",
          totalEvalAmount: 1100000,
          securitiesEvalAmount: 1000000,
          deposit: 100000,
          totalPurchaseAmount: 900000,
          totalPnl: 100000,
          totalPnlRate: 11.1,
          realizedPnl: null,
          prevDayTotalAsset: 1000000,
          assetIcdcAmt: 100000,
        },
      ],
      positions: [
        {
          id: "p1",
          snapshotId: "s1",
          ticker: "360750",
          name: "TIGER S&P500",
          quantity: 10,
          avgPrice: 90000,
          currentPrice: 100000,
          evalAmount: 1000000,
          pnl: 100000,
          pnlRate: null,
          weight: 1,
        },
      ],
    });
    expect(fake.whereParams()[0]).toEqual(["user-1"]);
  });
});
