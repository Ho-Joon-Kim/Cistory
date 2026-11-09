import { getTableConfig, PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { buildEstimateQuery, TABLE_DEFS } from "./data-usage";

const dialect = new PgDialect();

const tablesByName = new Map<string, PgTable>();
for (const value of Object.values(schema)) {
  try {
    const config = getTableConfig(value as PgTable);
    if (config?.name) tablesByName.set(config.name, value as PgTable);
  } catch {
    // not a table export
  }
}

function columnNames(tableName: string): string[] {
  const table = tablesByName.get(tableName);
  if (!table) throw new Error(`table ${tableName} not in schema`);
  return getTableConfig(table).columns.map((c) => c.name);
}

describe("data-usage TABLE_DEFS", () => {
  it("every table is user-scoped either directly or through its parent", () => {
    for (const def of TABLE_DEFS) {
      if (def.ownedVia) {
        expect(columnNames(def.table)).toContain(def.ownedVia.fk);
        expect(columnNames(def.ownedVia.parent)).toContain("user_id");
        expect(columnNames(def.ownedVia.parent)).toContain("id");
      } else {
        expect(columnNames(def.table), def.table).toContain("user_id");
      }
    }
  });

  it("counts commit_summaries through commits (it has no user_id column)", () => {
    const def = TABLE_DEFS.find((d) => d.table === "commit_summaries");
    expect(def).toBeDefined();
    const { sql: text, params } = dialect.sqlToQuery(buildEstimateQuery(def!, "user-1"));
    expect(text).toContain('JOIN "commits" p ON p."id" = t."commit_id"');
    expect(text).toContain('p."user_id" = $1');
    expect(text).not.toMatch(/FROM "commit_summaries" WHERE "user_id"/);
    expect(params).toEqual(["user-1"]);
  });

  it("keeps direct user_id filter for user-owned tables", () => {
    const def = TABLE_DEFS.find((d) => d.table === "commits");
    const { sql: text, params } = dialect.sqlToQuery(buildEstimateQuery(def!, "user-1"));
    expect(text).toContain('FROM "commits" t WHERE t."user_id" = $1');
    expect(params).toEqual(["user-1"]);
  });
});
