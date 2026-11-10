import { describe, expect, it } from "vitest";
import type { Database } from "@/db";
import { type PeriodDomainEnvelope, periodSnapshots } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import type { TestDb } from "@/db/testing/transactional-db";
import { useTransactionalDb } from "@/db/testing/transactional-db";
import { createDatabaseOverviewHistoryStore, getOverviewHistory } from "./history-store";

function envelope(data: unknown, status = "ready"): PeriodDomainEnvelope {
  return {
    status,
    computedAt: "2026-11-01T00:00:00.000Z",
    computeVersion: 4,
    errorCode: null,
    data,
  } as PeriodDomainEnvelope;
}

async function snapshot(
  db: TestDb,
  userId: string,
  periodKey: string,
  values: { commits: number; spending: number; steps: number; weight: number }
) {
  const date = `${periodKey}-05`;
  await db.insert(periodSnapshots).values({
    userId,
    periodType: "month",
    periodKey,
    status: "ready",
    coding: envelope({
      totalCommits: values.commits,
      dailyCommits: [{ date, count: values.commits }],
    }),
    spending: envelope({ daily: [{ date, spending: values.spending, income: 1000 }] }),
    health: envelope({
      metrics: [{ metric: "steps", days: [{ date, value: values.steps }] }],
      body: { weightSeries: [{ date, weight: values.weight }] },
    }),
    // A heavy domain the history must never need.
    location: envelope({ heatmap: [[0, 0, 1]] }),
  });
}

describe("overview history store against PostgreSQL", () => {
  const ctx = useTransactionalDb();

  it("reads only the caller's snapshots through the jsonb paths", async () => {
    const db = ctx.db();
    const me = await insertTestUser(db);
    const other = await insertTestUser(db);
    await snapshot(db, me, "2026-09", { commits: 7, spending: 30_000, steps: 4000, weight: 80.5 });
    await snapshot(db, me, "2026-10", { commits: 9, spending: 50_000, steps: 6000, weight: 80.1 });
    // Same periods for another user, with different numbers.
    await snapshot(db, other, "2026-09", { commits: 700, spending: 1, steps: 1, weight: 1 });
    await snapshot(db, other, "2026-10", { commits: 900, spending: 1, steps: 1, weight: 1 });

    const store = createDatabaseOverviewHistoryStore(db as unknown as Database);
    const rows = await store.findHistorySnapshots(me, [
      { periodType: "month", periodKeys: ["2026-09", "2026-10"] },
    ]);
    expect(rows).toHaveLength(2);
    const oct = rows.find((r) => r.periodKey === "2026-10");
    expect(oct).toEqual({
      periodType: "month",
      periodKey: "2026-10",
      status: "ready",
      codingStatus: "ready",
      dailyCommits: [{ date: "2026-10-05", count: 9 }],
      spendingStatus: "ready",
      spendingDaily: [{ date: "2026-10-05", spending: 50_000, income: 1000 }],
      healthStatus: "ready",
      healthMetrics: [{ metric: "steps", days: [{ date: "2026-10-05", value: 6000 }] }],
      weightSeries: [{ date: "2026-10-05", weight: 80.1 }],
    });

    const history = await getOverviewHistory(
      store,
      me,
      "month",
      "2026-10",
      new Date("2026-11-10T03:00:00Z")
    );
    expect(history.previous).toMatchObject({ periodKey: "2026-09", commits: 7, spending: 30_000 });
    expect(history.series.at(-1)).toMatchObject({
      periodKey: "2026-10",
      commits: 9,
      spending: 50_000,
      income: 1000,
      steps: { total: 6000, days: 1 },
      weight: { date: "2026-10-05", weight: 80.1 },
    });
    expect(history.weight).toEqual([
      { date: "2026-09-05", weight: 80.5 },
      { date: "2026-10-05", weight: 80.1 },
    ]);

    // The other user sees only their own numbers.
    const theirs = await getOverviewHistory(
      store,
      other,
      "month",
      "2026-10",
      new Date("2026-11-10T03:00:00Z")
    );
    expect(theirs.series.at(-1)?.commits).toBe(900);
  });
});
