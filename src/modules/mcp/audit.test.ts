import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import {
  ARGS_SUMMARY_MAX_BYTES,
  auditedRead,
  auditWindowStart,
  decodeAuditCursor,
  deleteAuditLog,
  encodeAuditCursor,
  McpAuditCursorError,
  McpAuditDeleteScopeError,
  McpAuditError,
  pickFields,
  recordDenial,
  recordUnauthenticatedDenial,
  resolveSoleOwner,
  summarizeArgs,
  textDigest,
} from "./audit";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), flush: vi.fn() },
}));

const ctx = {
  userId: "22222222-2222-4222-8222-222222222222",
  tokenId: "11111111-1111-4111-8111-111111111111",
  ip: "203.0.113.5",
  country: "KR",
};

describe("summarizeArgs", () => {
  it("keeps dates, ids and counts", () => {
    expect(
      summarizeArgs({
        from: "2026-11-01",
        to: "2026-11-13T09:00:00+09:00",
        tripId: "3f2b8c1e-1d2a-4b3c-9d8e-112233445566",
        limit: 100,
        includeRaw: false,
      })
    ).toEqual({
      from: "2026-11-01",
      to: "2026-11-13T09:00:00+09:00",
      tripId: "3f2b8c1e-1d2a-4b3c-9d8e-112233445566",
      limit: 100,
      includeRaw: false,
    });
  });

  it("stores free text only as length + hash prefix", () => {
    const summary = summarizeArgs({ q: "배달 민족" });
    expect(summary).toEqual({ q: textDigest("배달 민족") });
    expect(summary.q).toEqual({ len: 5, sha256: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(JSON.stringify(summary)).not.toContain("배달");
  });

  it("digests a single-word term too unless the tool declares it `keep`", () => {
    expect(summarizeArgs({ q: "starbucks" }).q).toEqual(textDigest("starbucks"));
    expect(summarizeArgs({ category: "food" }, { category: "keep" })).toEqual({ category: "food" });
  });

  it("drops coordinates by default and honors drop/count rules", () => {
    expect(
      summarizeArgs(
        { lat: 37.5, lon: 127.0, note: "x", ids: [1, 2, 3], secret: "s" },
        { ids: "count", secret: "drop" }
      )
    ).toEqual({ note: textDigest("x"), ids: { count: 3 } });
  });

  it("caps a 10KB argument payload", () => {
    const big = Object.fromEntries(
      Array.from({ length: 400 }, (_, i) => [`field_${i}`, "2026-11-13"])
    );
    const summary = summarizeArgs({ ...big, blob: "x".repeat(10_000) });
    expect(summary.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThanOrEqual(ARGS_SUMMARY_MAX_BYTES);
    expect(JSON.stringify(summary)).not.toContain("xxxx");
  });

  it("bounds arrays and nesting", () => {
    const summary = summarizeArgs({
      many: Array.from({ length: 50 }, (_, i) => i),
      deep: { a: { b: { c: { d: 1 } } } },
    });
    expect((summary.many as { count: number }).count).toBe(50);
    expect(JSON.stringify(summary.deep)).not.toContain('"d"');
  });

  it("summarizes non-objects to {}", () => {
    expect(summarizeArgs(null)).toEqual({});
    expect(summarizeArgs("text")).toEqual({});
    expect(summarizeArgs([1, 2])).toEqual({});
  });
});

describe("pickFields", () => {
  it("keeps only allowlisted fields and serializes dates", () => {
    expect(
      pickFields(
        { name: "집", lat: 37.5, rawText: "secret", updatedAt: new Date("2026-11-13T00:00:00Z") },
        ["name", "updatedAt", "missing"]
      )
    ).toEqual({ name: "집", updatedAt: "2026-11-13T00:00:00.000Z" });
    expect(pickFields(null, ["name"])).toBeNull();
  });
});

function insertDouble(impl: () => Promise<unknown>) {
  const update = vi.fn(() => ({ set: () => ({ where: async () => undefined }) }));
  const db = {
    insert: vi.fn(() => ({ values: () => ({ returning: impl }) })),
    update,
  };
  return { db: db as unknown as Database, update };
}

describe("auditedRead", () => {
  it("records before running and fills in the result count", async () => {
    const order: string[] = [];
    const { db, update } = insertDouble(async () => {
      order.push("audit");
      return [{ id: "audit-1" }];
    });
    const result = await auditedRead(
      db,
      ctx,
      { tool: "spending", argsSummary: {} },
      async () => {
        order.push("run");
        return [1, 2, 3];
      },
      (rows) => rows.length
    );
    expect(result).toEqual([1, 2, 3]);
    expect(order).toEqual(["audit", "run"]);
    expect(update).toHaveBeenCalledOnce();
  });

  it("fails closed: an audit insert failure means no data and a generic error", async () => {
    const { db } = insertDouble(async () => {
      throw Object.assign(new Error('insert into "mcp_audit_log" params: 배달'), { code: "23503" });
    });
    const run = vi.fn(async () => "data");
    const error = await auditedRead(db, ctx, { tool: "search", argsSummary: {} }, run).catch(
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(McpAuditError);
    expect((error as Error).message).not.toContain("배달");
    expect(run).not.toHaveBeenCalled();
  });

  it("returns the data when only the count update fails", async () => {
    const db = {
      insert: () => ({ values: () => ({ returning: async () => [{ id: "a" }] }) }),
      update: () => ({ set: () => ({ where: async () => Promise.reject(new Error("db")) }) }),
    } as unknown as Database;
    await expect(
      auditedRead(db, ctx, { tool: "health", argsSummary: {} }, async () => "ok")
    ).resolves.toBe("ok");
  });

  it("marks the row as an error and rethrows when the tool throws", async () => {
    const sets: unknown[] = [];
    const db = {
      insert: () => ({ values: () => ({ returning: async () => [{ id: "a" }] }) }),
      update: () => ({
        set: (value: unknown) => {
          sets.push(value);
          return { where: async () => undefined };
        },
      }),
    } as unknown as Database;
    await expect(
      auditedRead(db, ctx, { tool: "trips", argsSummary: {} }, async () => {
        throw Object.assign(new Error("boom"), { code: "TRIP_NOT_FOUND" });
      })
    ).rejects.toThrow("boom");
    expect(sets).toEqual([{ resultCount: null, outcome: "error", errorCode: "TRIP_NOT_FOUND" }]);
  });
});

describe("denials never throw", () => {
  it("recordDenial falls back to a log line", async () => {
    const db = {
      insert: () => ({ values: async () => Promise.reject(new Error("down")) }),
    } as unknown as Database;
    await expect(recordDenial(db, { ...ctx, reason: "ip_not_allowed" })).resolves.toBe(false);
  });

  it("recordUnauthenticatedDenial falls back to a log line", async () => {
    const db = {
      insert: () => ({
        values: () => ({ onConflictDoUpdate: async () => Promise.reject(new Error("down")) }),
      }),
    } as unknown as Database;
    await expect(
      recordUnauthenticatedDenial(db, {
        reason: "token_unrecognized",
        ip: null,
        country: null,
        ownerId: null,
      })
    ).resolves.toBe(false);
  });
});

describe("resolveSoleOwner", () => {
  function selectReturning(rows: { id: string }[]) {
    return { select: () => ({ from: () => ({ limit: async () => rows }) }) } as unknown as Database;
  }
  it("attributes to the only user, else null", async () => {
    expect(await resolveSoleOwner(selectReturning([{ id: "u1" }]))).toBe("u1");
    expect(await resolveSoleOwner(selectReturning([{ id: "u1" }, { id: "u2" }]))).toBeNull();
    expect(await resolveSoleOwner(selectReturning([]))).toBeNull();
  });
});

describe("auditWindowStart", () => {
  it("floors to the 15-minute window", () => {
    expect(auditWindowStart(new Date("2026-11-13T03:29:59.999Z")).toISOString()).toBe(
      "2026-11-13T03:15:00.000Z"
    );
  });
});

describe("audit cursor", () => {
  it("round-trips and rejects garbage", () => {
    const entry = {
      at: new Date("2026-11-13T03:00:00.123Z"),
      id: "3f2b8c1e-1d2a-4b3c-9d8e-112233445566",
    };
    expect(decodeAuditCursor(encodeAuditCursor(entry))).toEqual(entry);
    expect(() => decodeAuditCursor("bm9wZQ")).toThrow(McpAuditCursorError);
  });
});

describe("deleteAuditLog", () => {
  it("refuses an unscoped delete", async () => {
    await expect(deleteAuditLog({} as Database, "u", {})).rejects.toBeInstanceOf(
      McpAuditDeleteScopeError
    );
  });
});
