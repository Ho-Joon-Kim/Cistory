process.env.TZ = "Asia/Seoul";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { LocationReadExecutor } from "./location";
import { aggregateSpending } from "./spending";

const dialect = new PgDialect();

const input = {
  userId: "26d4c50e-42fd-4701-b3cc-1d92d826eabd",
  periodType: "week" as const,
  periodKey: "2026-W30",
  computedAt: new Date("2026-07-22T03:00:00.000Z"),
  computeVersion: 3,
  from: new Date("2026-07-19T15:00:00.000Z"),
  toExclusive: new Date("2026-07-26T15:00:00.000Z"),
};

function createExecutor(rowBatches: unknown[][]) {
  const queries: SQL[] = [];
  const execute = vi.fn(async (query: SQL) => {
    queries.push(query);
    return { rows: rowBatches.shift() ?? [] };
  });

  return {
    executor: { execute } satisfies LocationReadExecutor,
    queries,
  };
}

describe("aggregateSpending", () => {
  it("computes role-aware totals while ignoring excluded buckets and sorting output", async () => {
    const { executor, queries } = createExecutor([
      [{ tossMyName: "홍길동" }],
      [
        {
          date: "2026-07-03",
          bucket: "spending",
          role: "default",
          category: "food",
          amount: 500,
        },
        {
          date: "2026-07-01",
          bucket: "spending",
          role: "spending",
          category: "transport",
          amount: "1200",
        },
        {
          date: "2026-07-01",
          bucket: "income",
          role: "default",
          category: "salary",
          amount: 2_000,
        },
        {
          date: "2026-07-02",
          bucket: "ignore",
          role: "ignore",
          category: "excluded",
          amount: 99_999,
        },
        {
          date: "2026-07-02",
          bucket: "spending",
          role: "default",
          category: "food",
          amount: 700,
        },
      ],
    ]);

    await expect(aggregateSpending(executor, input)).resolves.toEqual({
      spending: 2_400,
      income: 2_000,
      netSpend: 400,
      daily: [
        { date: "2026-07-01", spending: 1_200, income: 2_000, netSpend: -800 },
        { date: "2026-07-02", spending: 700, income: 0, netSpend: 700 },
        { date: "2026-07-03", spending: 500, income: 0, netSpend: 500 },
      ],
      accountRoles: [
        { role: "default", spending: 1_200, income: 2_000 },
        { role: "spending", spending: 1_200, income: 0 },
      ],
      categories: [
        { category: "food", spending: 1_200 },
        { category: "transport", spending: 1_200 },
      ],
    });

    expect(executor.execute).toHaveBeenCalledTimes(2);
    const userQuery = dialect.sqlToQuery(queries[0]);
    const aggregateQuery = dialect.sqlToQuery(queries[1]);
    expect(userQuery.sql).toContain("toss_my_name");
    expect(aggregateQuery.sql).toContain("account_roles");
    expect(aggregateQuery.sql).toContain("Asia/Seoul");
    expect(aggregateQuery.params).toContain("홍길동");
    expect(aggregateQuery.params).toContainEqual(input.from);
    expect(aggregateQuery.params).toContainEqual(input.toExclusive);
  });
});
