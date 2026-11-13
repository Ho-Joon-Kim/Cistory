/**
 * Contribution rebalancing: split a new deposit across an account's holdings
 * so the post-contribution weights land as close to the target weights as
 * whole shares allow. No selling — overweight holdings simply receive nothing.
 *
 * `computeContributionRebalance` is pure. `loadRebalanceInputs` builds its
 * inputs from the account's latest holding snapshot and target allocations.
 *
 * Greedy rule: with `T_i = w_i × (V + C)` (V = current securities value, C =
 * contribution), repeatedly buy the holding whose shortfall `T_i − value_i`
 * is largest, as long as one share fits in the remaining cash and the share
 * brings the holding closer to its target (shortfall ≥ half a share's price).
 * Whatever can't be placed is reported as leftover cash.
 */

import { desc, eq } from "drizzle-orm";
import { type Database, getDb, holdingPositions, holdingSnapshots } from "@/db";
import { getTargetAllocations } from "./queries";

/** Target weights (0..1) must sum to 1 within this tolerance. */
export const TARGET_SUM_TOLERANCE = 0.005;
/** Safety bound on greedy iterations (each buys ≥ 1 share). */
const MAX_ITERATIONS = 100_000;

export interface RebalanceHolding {
  ticker: string;
  name: string;
  quantity: number;
  /** Latest price per share; null/0 means unknown. */
  price: number | null;
  /** Current evaluation amount. */
  value: number;
}

export interface RebalanceTarget {
  ticker: string;
  name: string;
  /** 0..1 */
  targetWeight: number;
}

export interface RebalanceInput {
  holdings: RebalanceHolding[];
  targets: RebalanceTarget[];
  /** Contribution amount (원). */
  contribution: number;
}

export interface RebalanceLine {
  ticker: string;
  name: string;
  targetWeight: number;
  price: number | null;
  currentQuantity: number;
  currentValue: number;
  currentWeight: number | null;
  buyQuantity: number;
  buyAmount: number;
  expectedValue: number;
  expectedWeight: number | null;
  /** True when the holding couldn't be bought (missing/zero price). */
  excluded: boolean;
}

export interface RebalanceResult {
  contribution: number;
  invested: number;
  leftoverCash: number;
  totalValueBefore: number;
  /** Securities value after the buys (leftover cash not included). */
  totalValueAfter: number;
  lines: RebalanceLine[];
  warnings: string[];
}

export type RebalanceErrorCode = "no_targets" | "target_sum" | "invalid_contribution";

export class RebalanceInputError extends Error {
  readonly code: RebalanceErrorCode;
  constructor(message: string, code: RebalanceErrorCode) {
    super(message);
    this.name = "RebalanceInputError";
    this.code = code;
  }
}

function usablePrice(price: number | null): number | null {
  return price !== null && Number.isFinite(price) && price > 0 ? price : null;
}

export function computeContributionRebalance(input: RebalanceInput): RebalanceResult {
  const { holdings, targets, contribution } = input;
  if (!Number.isFinite(contribution) || contribution <= 0) {
    throw new RebalanceInputError("납입 금액은 0보다 커야 합니다.", "invalid_contribution");
  }
  if (targets.length === 0) {
    throw new RebalanceInputError(
      "이 계좌에 목표 비중이 설정되어 있지 않습니다. 포트폴리오 화면에서 목표 비중을 먼저 정하세요.",
      "no_targets"
    );
  }
  const sum = targets.reduce((s, t) => s + t.targetWeight, 0);
  if (Math.abs(sum - 1) > TARGET_SUM_TOLERANCE) {
    throw new RebalanceInputError(
      `목표 비중의 합이 100%가 아닙니다(현재 ${(sum * 100).toFixed(1)}%). 목표 비중을 고친 뒤 다시 요청하세요.`,
      "target_sum"
    );
  }

  const byTicker = new Map<string, RebalanceHolding>();
  for (const h of holdings) {
    const prev = byTicker.get(h.ticker);
    byTicker.set(
      h.ticker,
      prev
        ? {
            ...prev,
            quantity: prev.quantity + h.quantity,
            value: prev.value + h.value,
            price: usablePrice(prev.price) ?? h.price,
          }
        : { ...h }
    );
  }
  const targetByTicker = new Map(targets.map((t) => [t.ticker, t]));

  // Lines: targets first (in their order), then held tickers without a target.
  const tickers = [
    ...targets.map((t) => t.ticker),
    ...[...byTicker.keys()].filter((ticker) => !targetByTicker.has(ticker)),
  ];
  const totalValueBefore = [...byTicker.values()].reduce((s, h) => s + h.value, 0);
  const totalTarget = totalValueBefore + contribution;
  const warnings: string[] = [];

  interface Work {
    ticker: string;
    name: string;
    targetWeight: number;
    price: number | null;
    quantity: number;
    value: number;
    buy: number;
    excluded: boolean;
  }
  const work: Work[] = tickers.map((ticker) => {
    const held = byTicker.get(ticker);
    const target = targetByTicker.get(ticker);
    const price = usablePrice(held?.price ?? null);
    const targetWeight = target?.targetWeight ?? 0;
    const excluded = targetWeight > 0 && price === null;
    if (excluded) {
      warnings.push(
        `${target?.name ?? ticker}(${ticker})의 최근 가격이 없어 배분에서 제외했습니다.`
      );
    }
    return {
      ticker,
      name: target?.name ?? held?.name ?? ticker,
      targetWeight,
      price,
      quantity: held?.quantity ?? 0,
      value: held?.value ?? 0,
      buy: 0,
      excluded,
    };
  });

  let cash = contribution;
  const shortfall = (w: Work) => w.targetWeight * totalTarget - (w.value + w.buy * (w.price ?? 0));

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const candidates = work
      .filter(
        (w) =>
          !w.excluded &&
          w.price !== null &&
          w.targetWeight > 0 &&
          w.price <= cash &&
          shortfall(w) >= w.price / 2
      )
      .sort((a, b) => shortfall(b) - shortfall(a) || a.ticker.localeCompare(b.ticker));
    const best = candidates[0];
    if (!best || best.price === null) break;
    const next = candidates[1];
    const gap = next ? shortfall(best) - shortfall(next) : shortfall(best);
    const shares = Math.max(
      1,
      Math.min(Math.floor(gap / best.price), Math.floor(cash / best.price))
    );
    best.buy += shares;
    cash -= shares * best.price;
  }

  const invested = contribution - cash;
  const totalValueAfter = totalValueBefore + invested;
  const lines: RebalanceLine[] = work.map((w) => {
    const buyAmount = w.buy * (w.price ?? 0);
    const expectedValue = w.value + buyAmount;
    return {
      ticker: w.ticker,
      name: w.name,
      targetWeight: w.targetWeight,
      price: w.price,
      currentQuantity: w.quantity,
      currentValue: w.value,
      currentWeight: totalValueBefore > 0 ? w.value / totalValueBefore : null,
      buyQuantity: w.buy,
      buyAmount,
      expectedValue,
      expectedWeight: totalValueAfter > 0 ? expectedValue / totalValueAfter : null,
      excluded: w.excluded,
    };
  });

  return {
    contribution,
    invested,
    leftoverCash: cash,
    totalValueBefore,
    totalValueAfter,
    lines,
    warnings,
  };
}

// ── Loader ───────────────────────────────────────────────────────────────────

export interface RebalanceInputs {
  holdings: RebalanceHolding[];
  targets: RebalanceTarget[];
  /** `asOfDate` (KST YYYY-MM-DD) of the snapshot the holdings/prices come from. */
  snapshotDate: string | null;
  snapshotTakenAt: Date | null;
}

/**
 * Holdings and prices from the account's latest snapshot, plus its target
 * weights. Null when the account isn't the user's.
 */
export async function loadRebalanceInputs(
  userId: string,
  accountId: string,
  database: Database = getDb()
): Promise<RebalanceInputs | null> {
  const targets = await getTargetAllocations(userId, accountId, database);
  if (!targets) return null;

  const [snapshot] = await database
    .select({
      id: holdingSnapshots.id,
      asOfDate: holdingSnapshots.asOfDate,
      takenAt: holdingSnapshots.takenAt,
    })
    .from(holdingSnapshots)
    .where(eq(holdingSnapshots.accountId, accountId))
    .orderBy(desc(holdingSnapshots.asOfDate), desc(holdingSnapshots.takenAt))
    .limit(1);

  const positions = snapshot
    ? await database
        .select({
          ticker: holdingPositions.ticker,
          name: holdingPositions.name,
          quantity: holdingPositions.quantity,
          currentPrice: holdingPositions.currentPrice,
          evalAmount: holdingPositions.evalAmount,
        })
        .from(holdingPositions)
        .where(eq(holdingPositions.snapshotId, snapshot.id))
    : [];

  return {
    holdings: positions.map((p) => ({
      ticker: p.ticker,
      name: p.name,
      quantity: Number(p.quantity),
      price: Number(p.currentPrice),
      value: Number(p.evalAmount),
    })),
    targets: targets.targets,
    snapshotDate: snapshot?.asOfDate ?? null,
    snapshotTakenAt: snapshot?.takenAt ?? null,
  };
}
