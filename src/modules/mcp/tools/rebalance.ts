/**
 * `contribution_rebalance`: split a new contribution across an account's
 * holdings toward its target weights (no selling, whole shares). Prices and
 * holdings come from the account's latest snapshot, whose date is returned so
 * the agent can say how fresh the basis is. Account numbers are never part of
 * the output.
 */

import { z } from "zod";
import {
  computeContributionRebalance,
  loadRebalanceInputs,
  RebalanceInputError,
  type RebalanceLine,
} from "@/modules/portfolio/rebalance";
import { McpToolError } from "../errors";
import { defineTool, type McpTool } from "../server";

/** 100억원: far above any real contribution, keeps the greedy loop bounded. */
const MAX_CONTRIBUTION = 10_000_000_000;

const round4 = (n: number | null) => (n === null ? null : Math.round(n * 10_000) / 10_000);

function lineOutput(line: RebalanceLine) {
  return {
    ticker: line.ticker,
    name: line.name,
    targetWeight: round4(line.targetWeight),
    price: line.price,
    currentQuantity: line.currentQuantity,
    currentValue: line.currentValue,
    currentWeight: round4(line.currentWeight),
    buyQuantity: line.buyQuantity,
    buyAmount: line.buyAmount,
    expectedValue: line.expectedValue,
    expectedWeight: round4(line.expectedWeight),
    excluded: line.excluded,
  };
}

export const contributionRebalanceTool = defineTool({
  name: "contribution_rebalance",
  kind: "read",
  scope: "read",
  title: "납입금 리밸런싱",
  description:
    "계좌 id와 납입 금액(원)을 받아, 매도 없이 새 납입금만으로 목표 비중에 가장 가까워지도록 종목별 매수 " +
    "수량·금액을 제안합니다. 정수 주식 단위이며 목표 대비 부족분이 큰 종목부터 채우고, 남는 돈은 " +
    "leftoverCash로 돌려줍니다. 가격과 보유 수량은 snapshotDate의 보유 스냅샷 기준이라 실제 주문 전 " +
    "가격을 다시 확인해야 합니다. 비중은 0..1 값입니다. 계좌 id는 portfolio 도구에서 얻습니다.",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: z.object({
    accountId: z.string().uuid().describe("portfolio 도구가 돌려준 계좌 id."),
    amount: z.number().int().positive().max(MAX_CONTRIBUTION).describe("납입 금액(원, 정수)."),
  }),
  argRules: { accountId: "keep", amount: "keep" },
  run: async (ctx, input) => {
    const inputs = await loadRebalanceInputs(ctx.userId, input.accountId, ctx.db);
    if (!inputs) throw new McpToolError("계좌를 찾을 수 없습니다.", "not_found");
    if (!inputs.snapshotDate) {
      throw new McpToolError(
        "이 계좌의 보유 스냅샷이 아직 없어 계산할 수 없습니다. 포트폴리오 동기화 후 다시 요청하세요.",
        "no_snapshot"
      );
    }

    let result: ReturnType<typeof computeContributionRebalance>;
    try {
      result = computeContributionRebalance({
        holdings: inputs.holdings,
        targets: inputs.targets,
        contribution: input.amount,
      });
    } catch (error) {
      if (error instanceof RebalanceInputError) throw new McpToolError(error.message, error.code);
      throw error;
    }

    return {
      structured: {
        accountId: input.accountId,
        snapshotDate: inputs.snapshotDate,
        snapshotTakenAt: inputs.snapshotTakenAt,
        contribution: result.contribution,
        invested: result.invested,
        leftoverCash: result.leftoverCash,
        totalValueBefore: result.totalValueBefore,
        totalValueAfter: result.totalValueAfter,
        lines: result.lines.map(lineOutput),
        warnings: result.warnings,
        notes: [
          "매도 없이 신규 납입금으로만 계산했습니다.",
          "expectedWeight는 남는 현금을 뺀 증권 평가액 기준입니다.",
        ],
      },
      count: result.lines.length,
    };
  },
});

export const REBALANCE_TOOLS: McpTool[] = [contributionRebalanceTool];
