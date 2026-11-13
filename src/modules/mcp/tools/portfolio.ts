/**
 * Portfolio read tool: `portfolio` — KIS accounts with their latest holdings,
 * target weights and TWR/XIRR returns.
 *
 * Account numbers (`cano`, `acntPrdtCd`) are masked without `sensitive-read`.
 * Credentials (`appKeyEnc`, `appSecretEnc`, `accessToken`, …) are not in the
 * allowlist at all, so no scope can reveal them; `lastSyncError` (raw KIS text)
 * is left out too.
 */

import { z } from "zod";
import {
  getPortfolioReturns,
  getPortfolioSummary,
  getTargetAllocations,
  PortfolioAccountNotFoundError,
} from "@/modules/portfolio/queries";
import { McpToolError } from "../errors";
import { type Allowlist, accessFromScopes, serializeRows } from "../serialize";
import { defineTool, type McpTool } from "../server";
import {
  dayRangeFields,
  kstIso,
  kstTime,
  NO_RECORDS,
  parseDayRange,
  READ_ANNOTATIONS,
} from "./common";

type Summary = Awaited<ReturnType<typeof getPortfolioSummary>>;
type AccountRow = Summary["accounts"][number];

export const ACCOUNT_ALLOWLIST: Allowlist<AccountRow> = {
  id: true,
  label: true,
  accountType: true,
  isActive: true,
  cano: { sensitive: "mask" },
  acntPrdtCd: { sensitive: "mask" },
  lastSyncedAt: kstTime,
};

export const portfolioTool = defineTool({
  name: "portfolio",
  kind: "read",
  scope: "read",
  title: "포트폴리오",
  description:
    "증권 계좌별 최신 평가액·예수금·손익, 보유 종목(수량·평균가·현재가·평가액·비중), 목표 비중, " +
    "기간 수익률(TWR, XIRR)을 돌려줍니다. accountId로 한 계좌만 볼 수 있습니다. " +
    "민감 정보 권한이 없으면 계좌번호는 •••로 가려집니다.",
  annotations: READ_ANNOTATIONS,
  inputSchema: z.object({
    accountId: z.string().uuid().optional().describe("한 계좌만 (생략하면 전체)."),
    ...dayRangeFields,
  }),
  argRules: { accountId: "keep", from: "keep", to: "keep" },
  run: async (ctx, input) => {
    const access = accessFromScopes(ctx.scopes);
    const returnsRange =
      input.from || input.to
        ? parseDayRange(input, { now: ctx.now, defaultDays: 366, maxDays: 3660 })
        : null;

    const summary = await getPortfolioSummary(ctx.userId, ctx.db);
    const accounts = input.accountId
      ? summary.accounts.filter((a) => a.id === input.accountId)
      : summary.accounts;
    if (input.accountId && accounts.length === 0) {
      throw new McpToolError("계좌를 찾을 수 없습니다.", "not_found");
    }

    let returns: Awaited<ReturnType<typeof getPortfolioReturns>>;
    try {
      returns = await getPortfolioReturns(
        ctx.userId,
        {
          accountId: input.accountId ?? null,
          from: returnsRange?.fromDate ?? null,
          to: returnsRange?.toDate ?? null,
        },
        ctx.db
      );
    } catch (error) {
      if (error instanceof PortfolioAccountNotFoundError) {
        throw new McpToolError("계좌를 찾을 수 없습니다.", "not_found");
      }
      throw error;
    }

    const targets = await Promise.all(
      accounts.map(
        async (a) => [a.id, await getTargetAllocations(ctx.userId, a.id, ctx.db)] as const
      )
    );
    const targetsById = new Map(targets);

    const serializedAccounts = serializeRows(accounts, ACCOUNT_ALLOWLIST, access).map(
      (account, i) => {
        const id = accounts[i].id;
        const snapshot = summary.latestSnapshots.find((s) => s.accountId === id) ?? null;
        const positions = snapshot
          ? summary.positions.filter((p) => p.snapshotId === snapshot.id)
          : [];
        const target = targetsById.get(id) ?? null;
        return {
          ...account,
          latestSnapshot: snapshot
            ? {
                asOfDate: snapshot.asOfDate,
                totalEvalAmount: snapshot.totalEvalAmount,
                securitiesEvalAmount: snapshot.securitiesEvalAmount,
                deposit: snapshot.deposit,
                totalPurchaseAmount: snapshot.totalPurchaseAmount,
                totalPnl: snapshot.totalPnl,
                totalPnlRate: snapshot.totalPnlRate,
                realizedPnl: snapshot.realizedPnl,
                prevDayTotalAsset: snapshot.prevDayTotalAsset,
              }
            : null,
          positions: positions.map((p) => ({
            ticker: p.ticker,
            name: p.name,
            quantity: p.quantity,
            avgPrice: p.avgPrice,
            currentPrice: p.currentPrice,
            evalAmount: p.evalAmount,
            pnl: p.pnl,
            pnlRate: p.pnlRate,
            weight: p.weight,
          })),
          targets: target ? { weights: target.targets, updatedAt: kstIso(target.updatedAt) } : null,
        };
      }
    );

    return {
      structured: {
        accounts: serializedAccounts,
        totals: input.accountId ? null : summary.totals,
        returns: {
          startDate: returns.startDate,
          endDate: returns.endDate,
          startValue: returns.startValue,
          endValue: returns.endValue,
          twr: {
            totalReturn: returns.twr.totalReturn,
            annualizedReturn: returns.twr.annualizedReturn,
            days: returns.twr.days,
          },
          xirr: returns.xirr,
          cashflows: returns.cashflows,
          coverage: returns.coverage,
        },
        message: accounts.length === 0 ? NO_RECORDS : null,
      },
      count: accounts.length,
    };
  },
});

export const PORTFOLIO_TOOLS: McpTool[] = [portfolioTool];
