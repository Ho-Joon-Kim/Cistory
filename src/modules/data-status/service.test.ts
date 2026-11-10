import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import { HEALTH_METRICS } from "@/modules/health/service";
import {
  clearRetainedCountsMemo,
  DAY_ANCHORED_HEALTH_METRICS,
  healthObservationSql,
  RETAINED_TTL_MS,
  retainedCounts,
} from "./service";

describe("healthObservationSql", () => {
  it("covers every day-anchored health metric", () => {
    const dayAnchored = HEALTH_METRICS.filter((m) => m.timeShape === "date").map((m) => m.key);
    expect(dayAnchored.length).toBeGreaterThan(0);
    for (const key of dayAnchored) expect(DAY_ANCHORED_HEALTH_METRICS).toContain(key);
  });

  it("excludes rollup sources and day-anchored metrics", () => {
    const query = new PgDialect().sqlToQuery(sql`WHERE ${healthObservationSql()}`);
    expect(query.sql).toContain("source NOT LIKE 'rollup:%'");
    expect(query.sql).toMatch(/metric NOT IN \(\$1(, \$\d+)+\)/);
    expect(query.params).toEqual([...DAY_ANCHORED_HEALTH_METRICS]);
  });
});

describe("retainedCounts memo", () => {
  const fakeDb = () => {
    const execute = vi.fn(async () => ({ rows: [{ count: 12, days: 3 }] }));
    return { db: { execute } as unknown as Database, execute };
  };

  beforeEach(() => clearRetainedCountsMemo());

  it("serves a second call within the TTL without querying", async () => {
    const { db, execute } = fakeDb();
    const first = await retainedCounts(db, "u1", ["health", "withings"], { now: 0 });
    const second = await retainedCounts(db, "u1", ["health", "withings"], { now: 60_000 });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(second).toEqual(first);
    expect(second.health).toEqual({ count: 12, days: 3 });
  });

  it("queries again after the TTL, for another user, or when a recovery job changes", async () => {
    const { db, execute } = fakeDb();
    await retainedCounts(db, "u1", ["health"], { now: 0, versions: { health: "j1:running" } });
    await retainedCounts(db, "u2", ["health"], { now: 1 });
    expect(execute).toHaveBeenCalledTimes(2);
    await retainedCounts(db, "u1", ["health"], {
      now: 2,
      versions: { health: "j1:completed" },
    });
    expect(execute).toHaveBeenCalledTimes(3);
    await retainedCounts(db, "u1", ["health"], {
      now: RETAINED_TTL_MS + 3,
      versions: { health: "j1:completed" },
    });
    expect(execute).toHaveBeenCalledTimes(4);
  });
});
