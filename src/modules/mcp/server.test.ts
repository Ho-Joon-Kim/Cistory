import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { mcpAuditLog, mcpTokens } from "@/db/schema";
import { ApiError } from "@/lib/api-handler";
import { logger } from "@/lib/logger";
import { McpInputError, McpToolError, RevokedMidflightError } from "./errors";
import { IdempotencyConflictError } from "./idempotency";
import {
  buildMcpServer,
  defineTool,
  type McpTool,
  type McpToolContext,
  runTool,
  toolsForScopes,
  writeAuditHook,
} from "./server";
import { parseTimeRange } from "./time";
import { ALL_TOOLS, findTool } from "./tools";
import { whoamiTool } from "./tools/meta";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), flush: vi.fn() },
}));

/**
 * Minimal Drizzle fake: records every query with its table and the methods
 * called on it, and resolves each through `answer`.
 */
function fakeDb(
  answer: (q: { op: string; table: unknown; chain: string[] }) => unknown = () => []
) {
  const queries: { op: string; table: unknown; chain: string[]; values?: unknown }[] = [];
  function builder(op: string, table: unknown) {
    const q = { op, table, chain: [] as string[], values: undefined as unknown };
    queries.push(q);
    const proxy: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
              try {
                return Promise.resolve(answer(q)).then(resolve, reject);
              } catch (error) {
                return Promise.reject(error).then(resolve, reject);
              }
            };
          }
          if (typeof prop === "symbol") return undefined;
          return (...args: unknown[]) => {
            q.chain.push(prop);
            if (prop === "from") q.table = args[0];
            if (prop === "values" || prop === "set") q.values = args[0];
            return proxy;
          };
        },
      }
    );
    return proxy;
  }
  // biome-ignore lint/suspicious/noExplicitAny: fake Drizzle client.
  const db: any = {
    select: () => builder("select", undefined),
    insert: (table: unknown) => builder("insert", table),
    update: (table: unknown) => builder("update", table),
    delete: (table: unknown) => builder("delete", table),
  };
  return { db, queries };
}

function context(db: unknown, overrides: Partial<McpToolContext> = {}): McpToolContext {
  return {
    db: db as McpToolContext["db"],
    userId: "11111111-1111-4111-8111-111111111111",
    tokenId: "22222222-2222-4222-8222-222222222222",
    tokenName: "에이전트",
    scopes: ["read"],
    ip: "203.0.113.5",
    country: "KR",
    now: new Date("2026-11-13T00:00:00Z"),
    ...overrides,
  };
}

const auditInserts = (queries: { op: string; table: unknown; values?: unknown }[]) =>
  queries.filter((q) => q.op === "insert" && q.table === mcpAuditLog);

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

function readTool(run: McpTool["run"], extra: Partial<McpTool> = {}): McpTool {
  return defineTool({
    name: "fake_read",
    kind: "read",
    scope: "read",
    title: "fake",
    description: "fake",
    annotations: READ_ANNOTATIONS,
    inputSchema: z.object({ q: z.string().optional() }),
    argRules: { q: "text" },
    run,
    ...extra,
  });
}

describe("registry", () => {
  it("has unique snake_case names", () => {
    const names = ALL_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("declares explicit annotations and a consistent kind/scope on every tool", () => {
    for (const tool of ALL_TOOLS) {
      expect(Object.keys(tool.annotations).sort()).toEqual([
        "destructiveHint",
        "idempotentHint",
        "openWorldHint",
        "readOnlyHint",
      ]);
      expect(tool.kind === "write").toBe(tool.scope === "write");
      expect(tool.annotations.readOnlyHint).toBe(tool.kind === "read");
    }
  });

  it("findTool looks up by name", () => {
    expect(findTool("whoami")).toBe(whoamiTool);
    expect(findTool("nope")).toBeUndefined();
  });

  it("defineTool rejects a write tool without the write scope", () => {
    expect(() =>
      defineTool({
        name: "bad",
        kind: "write",
        scope: "read",
        title: "",
        description: "",
        annotations: READ_ANNOTATIONS,
        inputSchema: z.object({}),
        run: async () => ({ structured: {} }),
      })
    ).toThrow();
  });
});

describe("toolsForScopes", () => {
  const tools = [
    { name: "a", scope: "read" },
    { name: "w", scope: "write" },
    { name: "s", scope: "sensitive-read" },
  ] as McpTool[];

  it("keeps only tools whose scope the token holds, in registry order", () => {
    expect(toolsForScopes(tools, ["read"]).map((t) => t.name)).toEqual(["a"]);
    expect(toolsForScopes(tools, ["write", "read"]).map((t) => t.name)).toEqual(["a", "w"]);
    expect(toolsForScopes(tools, ["sensitive-read"]).map((t) => t.name)).toEqual(["s"]);
  });

  it("buildMcpServer registers without throwing for every scope set", () => {
    const { db } = fakeDb();
    for (const scopes of [[], ["read"], ["read", "sensitive-read", "write"]] as const) {
      expect(buildMcpServer(context(db, { scopes: [...scopes] }), ALL_TOOLS)).toBeTruthy();
    }
  });
});

describe("runTool (read)", () => {
  it("audits before running, then fills the count, and returns JSON + structured content", async () => {
    const order: string[] = [];
    const { db, queries } = fakeDb((q) => {
      order.push(q.op);
      return q.op === "insert" ? [{ id: "audit-1" }] : [];
    });
    const tool = readTool(async () => {
      order.push("run");
      return { structured: { items: [{ at: new Date("2026-11-13T00:00:00Z") }] }, count: 1 };
    });

    const result = await runTool(tool, context(db), { q: "배달 민족" });

    expect(order).toEqual(["insert", "run", "update"]);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ items: [{ at: "2026-11-13T09:00:00+09:00" }] });
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(
      result.structuredContent
    );
    const [audit] = auditInserts(queries);
    expect(audit.values).toMatchObject({
      tool: "fake_read",
      outcome: "ok",
      argsSummary: { q: { len: 5 } },
      ip: "203.0.113.5",
      country: "KR",
    });
    expect(JSON.stringify(audit.values)).not.toContain("배달");
    expect(queries.find((q) => q.op === "update")?.values).toEqual({ resultCount: 1 });
  });

  it("does not run when the audit insert fails (fail-closed)", async () => {
    const { db } = fakeDb((q) => {
      if (q.op === "insert") throw new Error("connection refused; params: secret");
      return [];
    });
    const run = vi.fn();
    const result = await runTool(readTool(run), context(db), {});
    expect(run).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect((result.content[0] as { text: string }).text).toBe("감사 기록에 실패했습니다.");
  });

  it("turns business errors into isError with their Korean message", async () => {
    const { db } = fakeDb((q) => (q.op === "insert" ? [{ id: "a" }] : []));
    for (const error of [
      new McpInputError("기간은 최대 366일까지 조회할 수 있습니다."),
      new McpToolError("기록이 없습니다.", "empty"),
      new ApiError(404, "여행을 찾을 수 없습니다."),
    ]) {
      const result = await runTool(
        readTool(async () => {
          throw error;
        }),
        context(db),
        {}
      );
      expect(result).toEqual({ content: [{ type: "text", text: error.message }], isError: true });
    }
  });

  it("hides unexpected error text behind a generic message and marks the audit row", async () => {
    const { db, queries } = fakeDb((q) => (q.op === "insert" ? [{ id: "a" }] : []));
    const result = await runTool(
      readTool(async () => {
        throw new Error('Failed query: select * from transactions where merchant = "비밀"');
      }),
      context(db),
      {}
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("비밀");
    expect(JSON.stringify(result)).not.toContain("Failed query");
    expect(queries.find((q) => q.op === "update")?.values).toMatchObject({
      outcome: "error",
      errorCode: "tool_error",
    });
  });

  it("an offsetless time in a tool's input comes back as isError", async () => {
    const { db } = fakeDb((q) => (q.op === "insert" ? [{ id: "a" }] : []));
    const tool = readTool(async (_ctx, input) => {
      parseTimeRange({ from: (input as { q: string }).q });
      return { structured: {} };
    });
    const result = await runTool(tool, context(db), { q: "2026-11-13T09:00:00" });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/오프셋/);
  });

  it("rejects an oversized result", async () => {
    const { db } = fakeDb((q) => (q.op === "insert" ? [{ id: "a" }] : []));
    const result = await runTool(
      readTool(async () => ({ structured: { blob: "x".repeat(210 * 1024) } })),
      context(db),
      {}
    );
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/너무 큽니다/);
  });

  it("re-checks the scope and records scope_denied without running", async () => {
    const { db, queries } = fakeDb();
    const run = vi.fn();
    const result = await runTool(
      readTool(run, { scope: "sensitive-read" }),
      context(db, { scopes: ["read"] }),
      {}
    );
    expect(run).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(auditInserts(queries)[0].values).toMatchObject({
      outcome: "denied",
      denyReason: "scope_denied",
      tool: "fake_read",
    });
  });
});

describe("whoami", () => {
  it("returns the token name, scopes and server time in +09:00", async () => {
    const { db } = fakeDb((q) => (q.op === "insert" ? [{ id: "a" }] : []));
    const result = await runTool(whoamiTool, context(db, { scopes: ["read", "write"] }), {});
    expect(result.structuredContent).toEqual({
      tokenName: "에이전트",
      scopes: ["read", "write"],
      serverTime: "2026-11-13T09:00:00+09:00",
      timezone: "Asia/Seoul",
    });
  });
});

describe("write tools and writeAuditHook", () => {
  function writeTool(run: McpTool["run"]): McpTool {
    return defineTool({
      name: "fake_write",
      kind: "write",
      scope: "write",
      title: "fake",
      description: "fake",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: z.object({ name: z.string() }),
      argRules: { name: "text" },
      run,
    });
  }

  it("does not pre-audit a write; the hook audits inside the transaction", async () => {
    const order: string[] = [];
    const { db, queries } = fakeDb((q) => {
      order.push(
        `${q.op}:${q.table === mcpTokens ? "token" : q.table === mcpAuditLog ? "audit" : "?"}`
      );
      if (q.op === "select") return [{ revokedAt: null, expiresAt: null }];
      return [];
    });
    const ctx = context(db, { scopes: ["write"] });
    const tool = writeTool(async (c, input) => {
      order.push("change");
      const hook = writeAuditHook(c, {
        tool: "fake_write",
        args: input,
        argRules: { name: "text" },
        fields: ["name"],
      });
      await hook(db, { before: { name: "집", secret: 1 }, after: { name: "회사", secret: 2 } });
      return { structured: { ok: true } };
    });

    const result = await runTool(tool, ctx, { name: "회사" });

    expect(result.structuredContent).toEqual({ ok: true });
    expect(order).toEqual(["change", "select:token", "insert:audit"]);
    const tokenSelect = queries.find((q) => q.op === "select");
    expect(tokenSelect?.chain).toContain("for");
    expect(auditInserts(queries)[0].values).toMatchObject({
      tool: "fake_write",
      writeBefore: { name: "집" },
      writeAfter: { name: "회사" },
      argsSummary: { name: { len: 2 } },
    });
  });

  it.each([
    ["revoked", [{ revokedAt: new Date("2026-11-12T00:00:00Z"), expiresAt: null }]],
    ["expired", [{ revokedAt: null, expiresAt: new Date("2000-01-01T00:00:00Z") }]],
    ["deleted", []],
  ])("throws RevokedMidflightError when the token is %s", async (_label, rows) => {
    const { db, queries } = fakeDb((q) => (q.op === "select" ? rows : []));
    const hook = writeAuditHook(context(db, { scopes: ["write"] }), {
      tool: "fake_write",
      args: {},
      fields: [],
    });
    await expect(hook(db, { before: null, after: null })).rejects.toBeInstanceOf(
      RevokedMidflightError
    );
    expect(auditInserts(queries)).toHaveLength(0);
  });

  it("records a separate revoked_midflight denial when the hook aborts the write", async () => {
    const { db, queries } = fakeDb();
    const tool = writeTool(async () => {
      throw new RevokedMidflightError();
    });
    const result = await runTool(tool, context(db, { scopes: ["write"] }), { name: "x" });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/폐기/);
    const [denial] = auditInserts(queries);
    expect(denial.values).toMatchObject({
      outcome: "denied",
      denyReason: "revoked_midflight",
      tool: "fake_write",
    });
    expect(auditInserts(queries)).toHaveLength(1);
  });

  it.each([
    ["conflict", new McpToolError("이미 변경되었습니다.", "conflict"), "conflict"],
    ["not_found", new McpToolError("찾을 수 없습니다.", "not_found"), "not_found"],
    ["idempotency", new IdempotencyConflictError(), "idempotency_conflict"],
    ["4xx ApiError", new ApiError(400, "잘못된 요청", "BAD_INPUT"), "BAD_INPUT"],
  ])("records an error audit row when a write fails with %s", async (_label, error, code) => {
    const { db, queries } = fakeDb();
    const tool = writeTool(async () => {
      throw error;
    });
    const result = await runTool(tool, context(db, { scopes: ["write"] }), { name: "회사" });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toBe((error as Error).message);
    const rows = auditInserts(queries);
    expect(rows).toHaveLength(1);
    expect(rows[0].values).toMatchObject({
      outcome: "error",
      errorCode: code,
      tool: "fake_write",
      tokenId: "22222222-2222-4222-8222-222222222222",
      argsSummary: { name: { len: 2 } },
    });
  });

  it("records a generic code and no message for an unexpected write failure", async () => {
    const { db, queries } = fakeDb();
    const dbError = Object.assign(new Error('insert into "places" values ($1) 비밀주소'), {
      code: "23505",
    });
    const tool = writeTool(async () => {
      throw dbError;
    });
    const result = await runTool(tool, context(db, { scopes: ["write"] }), { name: "회사" });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("비밀주소");
    const [row] = auditInserts(queries);
    expect(row.values).toMatchObject({ outcome: "error", errorCode: "tool_error" });
    expect(JSON.stringify(row.values)).not.toContain("비밀주소");
    expect(JSON.stringify(row.values)).not.toContain("23505");
  });

  it("still returns the original error when the failure audit insert fails", async () => {
    const { db } = fakeDb((q) => {
      if (q.op === "insert") throw new Error("audit table down");
      return [];
    });
    const tool = writeTool(async () => {
      throw new McpToolError("이미 변경되었습니다.", "conflict");
    });
    const result = await runTool(tool, context(db, { scopes: ["write"] }), { name: "x" });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toBe("이미 변경되었습니다.");
    expect(logger.warn).toHaveBeenCalledWith(
      "[MCP] write failed (audit write failed)",
      expect.objectContaining({ tool: "fake_write", errorCode: "conflict" })
    );
  });

  it("does not record an error row for a successful write", async () => {
    const { db, queries } = fakeDb();
    const tool = writeTool(async () => ({ structured: { ok: true } }));
    const result = await runTool(tool, context(db, { scopes: ["write"] }), { name: "x" });
    expect(result.isError).toBeUndefined();
    expect(auditInserts(queries)).toHaveLength(0);
  });
});
