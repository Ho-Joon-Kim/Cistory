process.env.TZ = "Asia/Seoul";

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { commits } from "@/db";
import { insertTestUser } from "@/db/testing/fixtures";
import { useTransactionalDb } from "@/db/testing/transactional-db";
import { getPeriodRange } from "../period";
import { aggregateCoding } from "./coding";

/**
 * Pins the month window of the overview coding domain against a real
 * Asia/Seoul-session Postgres. The month 2026-10 snapshot used to report 4,673
 * commits while the year snapshot's October days summed to 4,678: the five
 * missing commits were exactly those between 00:00 and 09:00 KST on Oct 1,
 * because a bare JS Date bound against `committed_at` (UTC wall time) lost its
 * +09:00 offset and moved the window start to 09:00 KST.
 */
describe("aggregateCoding month window against a real Postgres", () => {
  const ctx = useTransactionalDb();

  it("counts commits in the first and last nine KST hours of the month, and nothing outside it", async () => {
    const db = ctx.db();
    const userId = await insertTestUser(db);
    const commitAt = (iso: string) => ({
      id: randomUUID(),
      userId,
      sha: randomUUID().replaceAll("-", "").padEnd(40, "0"),
      message: "feat: x",
      authorName: "t",
      committedAt: new Date(iso),
      repoFullName: "o/r",
      createdAt: new Date(iso),
    });
    await db.insert(commits).values([
      commitAt("2026-09-30T14:59:59.000Z"), // 2026-09-30 23:59:59 KST — outside
      commitAt("2026-09-30T15:18:52.000Z"), // 2026-10-01 00:18:52 KST — inside
      commitAt("2026-09-30T23:28:02.000Z"), // 2026-10-01 08:28:02 KST — inside
      commitAt("2026-10-31T14:59:00.000Z"), // 2026-10-31 23:59 KST — inside
      commitAt("2026-10-31T15:30:00.000Z"), // 2026-11-01 00:30 KST — outside
    ]);

    const result = await aggregateCoding(db, {
      userId,
      periodType: "month",
      periodKey: "2026-10",
      computedAt: new Date("2026-11-01T00:00:00.000Z"),
      computeVersion: 5,
      ...getPeriodRange("month", "2026-10"),
    });

    expect(result.totalCommits).toBe(3);
    expect(result.dailyCommits).toEqual([
      { date: "2026-10-01", count: 2 },
      { date: "2026-10-31", count: 1 },
    ]);
    // 2026-10-01 is a Thursday, 2026-10-31 a Saturday (Sunday-first indices).
    expect(result.weekdayHour.weekdays).toEqual([0, 0, 0, 0, 2, 0, 1]);
  });
});
