import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { buildLocationFillSql } from "./location";

describe("buildLocationFillSql", () => {
  const text = new PgDialect()
    .sqlToQuery(buildLocationFillSql("u", new Date("2026-03-01T00:00:00Z"), "2026-03-01", 10))
    .sql.toLowerCase();

  it("filters anomalies, undetailed rows, exif rows and uses the ±15 min window", () => {
    expect(text).toContain("anomaly is not true");
    expect(text).toContain("details_synced_at is not null");
    expect(text).toContain("is distinct from 'exif'");
    expect(text).toContain("interval '15 minutes'");
  });

  it("derives the KST day from UTC wall time and never uses a bare now()", () => {
    expect(text).toContain("at time zone 'utc' at time zone 'asia/seoul'");
    expect(text).not.toMatch(/\bnow\s*\(/);
  });
});
