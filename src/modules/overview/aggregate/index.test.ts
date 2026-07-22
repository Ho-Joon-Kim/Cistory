process.env.TZ = "Asia/Seoul";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { aggregateCoding } from "./coding";
import type { PeriodDomainAggregators, PeriodTransactionExecutor } from "./index";
import { aggregatePeriod } from "./index";
import { aggregatePortfolio } from "./portfolio";

const input = {
  userId: "26d4c50e-42fd-4701-b3cc-1d92d826eabd",
  periodType: "month" as const,
  periodKey: "2026-07",
  computedAt: new Date("2026-07-22T03:00:00.000Z"),
  computeVersion: 3,
};

const dialect = new PgDialect();

function transactionExecutor() {
  const transaction = vi.fn(
    async <T>(callback: (tx: { execute: () => Promise<unknown> }) => Promise<T>) =>
      callback({ execute: vi.fn(async () => ({ rows: [] })) })
  );
  return { transaction } satisfies PeriodTransactionExecutor;
}

function aggregators(overrides: Partial<PeriodDomainAggregators> = {}): PeriodDomainAggregators {
  return {
    coding: vi.fn(async () => ({ totalCommits: 4 }) as never),
    location: vi.fn(async () => ({ visits: { count: 2 } }) as never),
    health: vi.fn(async () => ({ metrics: [] }) as never),
    spending: vi.fn(async () => ({ netSpend: -1_000 }) as never),
    portfolio: vi.fn(async () => ({ hasAccounts: true, evaluationTrend: [] }) as never),
    ...overrides,
  };
}

describe("aggregatePeriod", () => {
  it("returns ready envelopes for all five domains through independent boundaries", async () => {
    const executor = transactionExecutor();

    const result = await aggregatePeriod(executor, input, aggregators());

    expect(Object.keys(result)).toEqual(["coding", "location", "health", "spending", "portfolio"]);
    expect(Object.values(result).every((domain) => domain.status === "ready")).toBe(true);
    expect(result.coding).toMatchObject({
      data: { totalCommits: 4 },
      computedAt: "2026-07-22T03:00:00.000Z",
      computeVersion: 3,
      errorCode: null,
    });
    expect(executor.transaction).toHaveBeenCalledTimes(5);
  });

  it("returns an empty ready portfolio for a user without brokerage accounts", async () => {
    const result = await aggregatePeriod(
      transactionExecutor(),
      input,
      aggregators({
        portfolio: vi.fn(
          async () =>
            ({
              hasAccounts: false,
              evaluationTrend: [],
              twr: { totalReturn: null, annualizedReturn: null, days: 0 },
            }) as never
        ),
      })
    );

    expect(result.portfolio).toMatchObject({
      status: "ready",
      data: { hasAccounts: false, evaluationTrend: [] },
      errorCode: null,
    });
    expect(result.coding.status).toBe("ready");
  });

  it("isolates a statement failure and keeps the other four domains ready", async () => {
    const failing = aggregators({
      location: vi.fn(async () => {
        throw Object.assign(new Error("transaction is aborted"), { code: "25P02" });
      }),
    });

    const result = await aggregatePeriod(transactionExecutor(), input, failing);

    expect(result.location).toEqual({
      data: null,
      status: "failed",
      computedAt: "2026-07-22T03:00:00.000Z",
      computeVersion: 3,
      errorCode: "LOCATION_AGGREGATION_FAILED",
    });
    expect([result.coding, result.health, result.spending, result.portfolio]).toSatisfy((domains) =>
      domains.every((domain) => domain.status === "ready")
    );
  });

  it("is deterministic for the same input", async () => {
    const domainAggregators = aggregators();

    const first = await aggregatePeriod(transactionExecutor(), input, domainAggregators);
    const second = await aggregatePeriod(transactionExecutor(), input, domainAggregators);

    expect(second).toEqual(first);
  });
});

describe("domain payload contracts", () => {
  const domainInput = {
    ...input,
    from: new Date("2026-06-30T15:00:00.000Z"),
    toExclusive: new Date("2026-07-31T15:00:00.000Z"),
  };

  function codingExecutor() {
    const queries: SQL[] = [];
    const batches = [
      [
        {
          date: "2026-07-01",
          weekday: 3,
          hour: 10,
          project: "cistory/app",
          commitType: "feat",
          count: 2,
          additions: 20,
          deletions: 3,
          firstCommit: new Date("2026-07-01T01:00:00.000Z"),
          lastCommit: new Date("2026-07-01T02:00:00.000Z"),
        },
      ],
      [
        {
          date: "2026-07-01",
          seconds: 7_200,
          languages: [{ name: "TypeScript", totalSeconds: 6_000 }],
          projects: [{ name: "Cistory", totalSeconds: 7_200 }],
        },
      ],
      [{ date: "2026-07-01", project: "Cistory", durationSeconds: 7_200 }],
    ];
    return {
      execute: vi.fn(async (query: SQL) => {
        queries.push(query);
        return { rows: batches.shift() ?? [] };
      }),
      queries,
    };
  }

  it("includes report-only coding fields for a year", async () => {
    const executor = codingExecutor();
    const result = await aggregateCoding(executor, {
      ...domainInput,
      periodType: "year",
      periodKey: "2026",
    });

    expect(result.yearlyReport).toEqual({
      languageTrend: [{ quarter: "Q3", languages: [{ name: "TypeScript", seconds: 6_000 }] }],
      projectTimeline: [
        {
          name: "cistory/app",
          firstCommit: "2026-07-01T01:00:00.000Z",
          lastCommit: "2026-07-01T02:00:00.000Z",
          totalCommits: 2,
        },
      ],
      commitTypes: [{ type: "feat", count: 2 }],
    });
    expect(result.deepWorkSessions).toHaveLength(1);
    expect(result.weekdayHour.weekdays[3]).toBe(2);
    expect(dialect.sqlToQuery(executor.queries[0]).sql).toContain(
      "at time zone 'UTC' at time zone 'Asia/Seoul'"
    );
  });

  it("omits yearly report fields for a week", async () => {
    const result = await aggregateCoding(codingExecutor(), {
      ...domainInput,
      periodType: "week",
      periodKey: "2026-W27",
    });

    expect(result).not.toHaveProperty("yearlyReport");
    expect(result.commitTypes).toEqual([{ type: "feat", count: 2 }]);
  });

  it("treats no portfolio snapshots as an account-less empty result", async () => {
    const executor = { execute: vi.fn(async () => ({ rows: [] })) };

    await expect(aggregatePortfolio(executor, domainInput)).resolves.toEqual({
      hasAccounts: false,
      evaluationTrend: [],
      twr: { totalReturn: null, annualizedReturn: null, days: 0 },
    });
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });

  it("distinguishes an account with no snapshots from an account-less user", async () => {
    const batches = [[{ count: 1 }], [], []];
    const executor = { execute: vi.fn(async () => ({ rows: batches.shift() ?? [] })) };

    await expect(aggregatePortfolio(executor, domainInput)).resolves.toEqual({
      hasAccounts: true,
      evaluationTrend: [],
      twr: { totalReturn: null, annualizedReturn: null, days: 0 },
    });
  });
});
