import { beforeEach, describe, expect, it, vi } from "vitest";
import { allowlistFields, MASK, sensitiveFields } from "../serialize";
import { ACCOUNT_ALLOWLIST, portfolioTool } from "./portfolio";
import { callTool, toolContext } from "./test-context";

const mocks = vi.hoisted(() => ({
  getPortfolioSummary: vi.fn(),
  getPortfolioReturns: vi.fn(),
  getTargetAllocations: vi.fn(),
}));
vi.mock("@/modules/portfolio/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/portfolio/queries")>();
  return {
    ...actual,
    getPortfolioSummary: mocks.getPortfolioSummary,
    getPortfolioReturns: mocks.getPortfolioReturns,
    getTargetAllocations: mocks.getTargetAllocations,
  };
});

const ACCOUNT_ID = "33333333-3333-4333-8333-333333333333";
const SECRETS = ["APPKEY-SECRET", "APPSECRET-SECRET", "ACCESS-TOKEN-SECRET", "KIS raw error"];

beforeEach(() => {
  mocks.getPortfolioSummary.mockResolvedValue({
    accounts: [
      {
        id: ACCOUNT_ID,
        label: "ISA",
        cano: "12345678",
        acntPrdtCd: "01",
        accountType: "isa",
        isActive: true,
        lastSyncedAt: new Date("2026-11-13T00:00:00Z"),
        lastSyncError: "KIS raw error",
        // Credentials a careless service change could start returning:
        appKeyEnc: "APPKEY-SECRET",
        appSecretEnc: "APPSECRET-SECRET",
        accessToken: "ACCESS-TOKEN-SECRET",
      },
    ],
    totals: { totalEvalAmount: 1000 },
    latestSnapshots: [
      {
        id: "s1",
        accountId: ACCOUNT_ID,
        asOfDate: "2026-11-12",
        totalEvalAmount: 1000,
        deposit: 10,
      },
    ],
    positions: [
      { id: "p", snapshotId: "s1", ticker: "069500", name: "KODEX 200", quantity: 3, weight: 0.9 },
    ],
  });
  mocks.getPortfolioReturns.mockResolvedValue({
    twr: { totalReturn: 0.05, annualizedReturn: 0.1, days: 100, periods: [{ big: true }] },
    xirr: 0.07,
    cashflows: [],
    startDate: "2026-05-12",
    endDate: "2026-11-12",
    startValue: 900,
    endValue: 1000,
    coverage: { accountCount: 1, completeDates: 100, excludedDates: [] },
  });
  mocks.getTargetAllocations.mockResolvedValue({
    targets: [{ ticker: "069500", name: "KODEX 200", targetWeight: 1 }],
    updatedAt: "2026-11-01T00:00:00.000Z",
  });
});

describe("portfolio tool", () => {
  it("masks account numbers for a read token", async () => {
    const out = await callTool(portfolioTool, {});
    const [account] = out.structured.accounts as Record<string, unknown>[];
    expect(account.cano).toBe(MASK);
    expect(account.acntPrdtCd).toBe(MASK);
    expect(account.positions).toHaveLength(1);
    expect(account.targets).toEqual({
      weights: [{ ticker: "069500", name: "KODEX 200", targetWeight: 1 }],
      updatedAt: "2026-11-01T09:00:00+09:00",
    });
    expect(out.structured.returns).toMatchObject({ twr: { totalReturn: 0.05, days: 100 } });
    expect(JSON.stringify(out.structured)).not.toContain("periods");
  });

  it("shows account numbers with sensitive-read but never credentials", async () => {
    const out = await callTool(portfolioTool, {}, toolContext(["read", "sensitive-read"]));
    const [account] = out.structured.accounts as Record<string, unknown>[];
    expect(account.cano).toBe("12345678");
    expect(account.acntPrdtCd).toBe("01");
    const text = JSON.stringify(out.structured);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/appKey|appSecret|accessToken|lastSyncError/);
  });

  it("pins the account allowlist", () => {
    expect(sensitiveFields(ACCOUNT_ALLOWLIST).sort()).toEqual(["acntPrdtCd", "cano"]);
    expect(allowlistFields(ACCOUNT_ALLOWLIST)).not.toEqual(
      expect.arrayContaining(["appKeyEnc", "appSecretEnc", "accessToken"])
    );
  });

  it("rejects an account the user doesn't own", async () => {
    await expect(
      callTool(portfolioTool, { accountId: "44444444-4444-4444-8444-444444444444" })
    ).rejects.toThrow("계좌를 찾을 수 없습니다.");
  });
});
