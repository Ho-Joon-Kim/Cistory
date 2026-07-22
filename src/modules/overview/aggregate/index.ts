import { getPeriodRange } from "../period";
import type {
  CodingAggregate,
  HealthAggregate,
  LocationAggregate,
  PeriodAggregateInput,
  PeriodAggregatePayload,
  PeriodDomainEnvelope,
  PortfolioAggregate,
  SpendingAggregate,
} from "../types";
import { aggregateCoding } from "./coding";
import { aggregateHealth } from "./health";
import {
  aggregateDerivedLocation,
  aggregatePeriodHeatmap,
  type LocationReadExecutor,
} from "./location";
import { aggregatePortfolio } from "./portfolio";
import { aggregateSpending } from "./spending";

export interface PeriodTransactionExecutor {
  transaction<T>(callback: (tx: LocationReadExecutor) => Promise<T>): Promise<T>;
}

type DomainInput = Omit<PeriodAggregateInput, "computedAt"> & {
  computedAt: Date;
  from: Date;
  toExclusive: Date;
};
type DomainAggregator<T> = (executor: LocationReadExecutor, input: DomainInput) => Promise<T>;

export interface PeriodDomainAggregators {
  coding: DomainAggregator<CodingAggregate>;
  location: DomainAggregator<LocationAggregate>;
  health: DomainAggregator<HealthAggregate>;
  spending: DomainAggregator<SpendingAggregate>;
  portfolio: DomainAggregator<PortfolioAggregate>;
}

const defaultAggregators: PeriodDomainAggregators = {
  coding: aggregateCoding,
  location: async (executor, input) => ({
    derived: await aggregateDerivedLocation(executor, input),
    heatmap: await aggregatePeriodHeatmap(executor, input),
  }),
  health: aggregateHealth,
  spending: aggregateSpending,
  portfolio: aggregatePortfolio,
};

async function executeDomain<T>(
  executor: PeriodTransactionExecutor,
  input: DomainInput,
  name: keyof PeriodDomainAggregators,
  aggregate: DomainAggregator<T>
): Promise<PeriodDomainEnvelope<T>> {
  try {
    const data = await executor.transaction((tx) => aggregate(tx, input));
    return {
      data,
      status: "ready",
      computedAt: input.computedAt.toISOString(),
      computeVersion: input.computeVersion,
      errorCode: null,
    };
  } catch {
    return {
      data: null,
      status: "failed",
      computedAt: input.computedAt.toISOString(),
      computeVersion: input.computeVersion,
      errorCode: `${name.toUpperCase()}_AGGREGATION_FAILED`,
    };
  }
}

/**
 * Computes each domain serially in its own transaction. A PostgreSQL statement
 * failure aborts only that domain's transaction; later domains receive fresh
 * transaction boundaries and remain publishable.
 */
export async function aggregatePeriod(
  executor: PeriodTransactionExecutor,
  rawInput: PeriodAggregateInput,
  aggregators: PeriodDomainAggregators = defaultAggregators
): Promise<PeriodAggregatePayload> {
  const range = getPeriodRange(rawInput.periodType, rawInput.periodKey);
  const input: DomainInput = {
    ...rawInput,
    computedAt: rawInput.computedAt ?? new Date(),
    ...range,
  };

  const coding = await executeDomain(executor, input, "coding", aggregators.coding);
  const location = await executeDomain(executor, input, "location", aggregators.location);
  const health = await executeDomain(executor, input, "health", aggregators.health);
  const spending = await executeDomain(executor, input, "spending", aggregators.spending);
  const portfolio = await executeDomain(executor, input, "portfolio", aggregators.portfolio);

  return { coding, location, health, spending, portfolio };
}
