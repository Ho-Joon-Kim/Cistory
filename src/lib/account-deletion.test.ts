import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import { users } from "@/db/schema";
import { deleteAccount } from "./account-deletion";

const dialect = new PgDialect();

it("deletes all user sessions and OAuth credentials with application data in one transaction", async () => {
  const statements: { sql: string; params: unknown[] }[] = [];
  const tx = {
    execute: vi.fn(async (query) => {
      statements.push(dialect.sqlToQuery(query));
    }),
    delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  };
  const db = { transaction: vi.fn(async (operation) => operation(tx)) };
  await deleteAccount(db as unknown as Database, "user-to-delete");
  expect(db.transaction).toHaveBeenCalledOnce();
  expect(tx.delete).toHaveBeenCalledWith(users);
  expect(statements.map((statement) => statement.sql)).toEqual([
    'DELETE FROM "session" WHERE "userId" = $1',
    'DELETE FROM "account" WHERE "userId" = $1',
    'DELETE FROM "user" WHERE "id" = $1',
  ]);
  expect(statements.every((statement) => statement.params[0] === "user-to-delete")).toBe(true);
});

describe("transaction failures", () => {
  it("propagates deletion failure so the transaction rolls back", async () => {
    const tx = { execute: vi.fn().mockRejectedValue(new Error("database failure")) };
    const db = { transaction: vi.fn(async (operation) => operation(tx)) };
    await expect(deleteAccount(db as unknown as Database, "user-1")).rejects.toThrow(
      "database failure"
    );
  });
});
