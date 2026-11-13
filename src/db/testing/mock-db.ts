/**
 * Queue-driven fake Drizzle database for route/service characterization tests.
 *
 * Every top-level query (`select`, `selectDistinct`, `insert`, `update`,
 * `delete`, `execute`) takes the next entry from `results` at the moment it is
 * built, so `Promise.all([...])` resolves in source order. Chained builder
 * methods are recorded and return the same thenable, which resolves to the
 * queued rows (`execute` resolves to `{ rows }`). `transaction(fn)` runs `fn`
 * against the same fake.
 *
 * `whereParams()` renders every recorded `.where(...)` condition with the real
 * Postgres dialect and returns its bound parameters, so a test can assert that
 * a query is scoped to the caller's user id.
 */

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

export interface MockDbCall {
  op: string;
  chain: { method: string; args: unknown[] }[];
}

const dialect = new PgDialect();

export function createMockDb(results: unknown[] = []) {
  const queue = [...results];
  const calls: MockDbCall[] = [];
  const next = () => (queue.length > 0 ? queue.shift() : []);

  function builder(op: string, args: unknown[]) {
    const call: MockDbCall = { op, chain: [{ method: op, args }] };
    calls.push(call);
    const result = next();
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
              Promise.resolve(result).then(resolve, reject);
          }
          if (typeof prop === "symbol") return undefined;
          return (...chainArgs: unknown[]) => {
            call.chain.push({ method: prop, args: chainArgs });
            return proxy;
          };
        },
      }
    );
    return proxy;
  }

  // biome-ignore lint/suspicious/noExplicitAny: a fake standing in for the Drizzle client.
  const db: any = {
    select: (...args: unknown[]) => builder("select", args),
    selectDistinct: (...args: unknown[]) => builder("selectDistinct", args),
    insert: (...args: unknown[]) => builder("insert", args),
    update: (...args: unknown[]) => builder("update", args),
    delete: (...args: unknown[]) => builder("delete", args),
    execute: async (...args: unknown[]) => {
      calls.push({ op: "execute", chain: [{ method: "execute", args }] });
      return { rows: next() };
    },
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };

  function whereParams(): unknown[][] {
    return calls.flatMap((call) =>
      call.chain
        .filter((step) => step.method === "where" && step.args[0])
        .map((step) => dialect.sqlToQuery(step.args[0] as SQL).params)
    );
  }

  function executeParams(): unknown[][] {
    return calls
      .filter((call) => call.op === "execute")
      .map((call) => dialect.sqlToQuery(call.chain[0].args[0] as SQL).params);
  }

  /** Arguments of every `.set(...)` / `.values(...)` call, in order. */
  function writes(method: "set" | "values"): unknown[] {
    return calls.flatMap((call) =>
      call.chain.filter((step) => step.method === method).map((step) => step.args[0])
    );
  }

  return { db, calls, whereParams, executeParams, writes, remaining: () => queue.length };
}
