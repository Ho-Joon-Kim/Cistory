import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { HEALTH_METRICS } from "@/modules/health/service";
import { DAY_ANCHORED_HEALTH_METRICS, healthObservationSql } from "./service";

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
