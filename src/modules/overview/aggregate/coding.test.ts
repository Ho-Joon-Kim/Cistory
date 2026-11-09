process.env.TZ = "Asia/Seoul";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { getPeriodRange } from "../period";
import { aggregateCoding } from "./coding";
import type { LocationReadExecutor } from "./location";

const dialect = new PgDialect();

// October 2026 in KST: [2026-10-01 00:00 KST, 2026-11-01 00:00 KST)
//                   == [2026-09-30 15:00 UTC, 2026-10-31 15:00 UTC)
const input = {
  userId: "26d4c50e-42fd-4701-b3cc-1d92d826eabd",
  periodType: "month" as const,
  periodKey: "2026-10",
  computedAt: new Date("2026-11-01T00:00:00.000Z"),
  computeVersion: 5,
  ...getPeriodRange("month", "2026-10"),
};

function createExecutor() {
  const queries: SQL[] = [];
  const execute = vi.fn(async (query: SQL) => {
    queries.push(query);
    return { rows: [] };
  });
  return { executor: { execute } satisfies LocationReadExecutor, queries };
}

describe("aggregateCoding period bounds", () => {
  it("binds the period window as UTC wall time, matching how committed_at/started_at are stored", async () => {
    const { executor, queries } = createExecutor();

    await aggregateCoding(executor, input);

    const commitQuery = dialect.sqlToQuery(queries[0]);
    const sessionQuery = dialect.sqlToQuery(queries[2]);
    // A bare JS Date here reaches node-postgres, which serializes it in the
    // process timezone ("2026-10-01T00:00:00.000+09:00"); compared against a
    // `timestamp without time zone` column Postgres drops the offset, so the
    // month started at 09:00 KST and silently lost every commit made between
    // midnight and 09:00 on the 1st (month 2026-10: 4,673 vs year: 4,678).
    for (const query of [commitQuery, sessionQuery]) {
      expect(query.params).not.toContainEqual(input.from);
      expect(query.params).not.toContainEqual(input.toExclusive);
      expect(query.params).toContain("2026-09-30T15:00:00.000Z");
      expect(query.params).toContain("2026-10-31T15:00:00.000Z");
    }
  });

  it("keeps weekday indices Sunday-first (Postgres EXTRACT(DOW)), matching the overview chart labels", async () => {
    const execute = vi.fn(async (query: SQL) => {
      const text = dialect.sqlToQuery(query).sql;
      if (!text.includes('"commits"')) return { rows: [] };
      return {
        rows: [
          // 2026-10-01 is a Thursday (DOW 4)
          {
            date: "2026-10-01",
            weekday: 4,
            hour: 0,
            project: "o/r",
            commitType: "feat",
            count: 5,
            additions: 1,
            deletions: 0,
            firstCommit: "2026-09-30 15:18:52",
            lastCommit: "2026-09-30 23:28:02",
          },
        ],
      };
    });

    const result = await aggregateCoding({ execute }, input);

    expect(dialect.sqlToQuery(execute.mock.calls[0][0]).sql).toContain("EXTRACT(DOW FROM");
    expect(result.weekdayHour.weekdays).toEqual([0, 0, 0, 0, 5, 0, 0]);
  });
});
