import { randomUUID } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DELETE, GET } from "@/app/api/mcp/route";
import { type McpScope, mcpAuditLog, mcpTokens, users } from "@/db/schema";
import { onDenied } from "./alerts-hook";
import {
  handleMcpPost,
  MCP_MAX_BATCH_MESSAGES,
  MCP_MAX_BODY_BYTES,
  type McpHttpDeps,
} from "./http";
import { defineTool, type McpTool } from "./server";
import { generateRawToken, hashSecret } from "./tokens";
import { whoamiTool } from "./tools/meta";

vi.mock("./alerts-hook", () => ({ onDenied: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), flush: vi.fn() },
}));

const OWNER = "11111111-1111-4111-8111-111111111111";
const URL_MCP = "https://cistory.example/api/mcp";

const fakeWriteTool = defineTool({
  name: "fake_write",
  kind: "write",
  scope: "write",
  title: "쓰기",
  description: "test write tool",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: z.object({}),
  run: async () => ({ structured: { written: true } }),
});

const fakeSensitiveTool = defineTool({
  name: "fake_sensitive",
  kind: "read",
  scope: "sensitive-read",
  title: "민감",
  description: "test sensitive tool",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: z.object({}),
  run: async () => ({ structured: { secret: true } }),
});

const TOOLS: McpTool[] = [whoamiTool, fakeSensitiveTool, fakeWriteTool];

interface TokenOptions {
  scopes?: McpScope[];
  cidrs?: string[];
  countries?: string[];
  revokedAt?: Date | null;
  expiresAt?: Date | null;
}

function makeToken(options: TokenOptions = {}) {
  const { raw, lookupId, secret } = generateRawToken();
  const row = {
    id: randomUUID(),
    userId: OWNER,
    name: "테스트 에이전트",
    lookupId,
    secretHash: hashSecret(secret),
    scopes: options.scopes ?? ["read"],
    allowedCidrs: options.cidrs ?? [],
    allowedCountries: options.countries ?? [],
    expiresAt: options.expiresAt ?? null,
    revokedAt: options.revokedAt ?? null,
    // Recent, so verifyToken skips the last_used_at update.
    lastUsedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return { raw, row };
}

interface Query {
  op: string;
  table: unknown;
  chain: string[];
  values?: Record<string, unknown>;
}

/** Fake Drizzle client answering by table: the token row, the sole owner, audit ids. */
function fakeDb(tokenRow: unknown | null) {
  const queries: Query[] = [];
  function builder(op: string, table: unknown) {
    const q: Query = { op, table, chain: [] };
    queries.push(q);
    const answer = () => {
      if (op === "select" && q.table === mcpTokens) return tokenRow ? [tokenRow] : [];
      if (op === "select" && q.table === users) return [{ id: OWNER }];
      if (op === "insert") return [{ id: randomUUID() }];
      return [];
    };
    const proxy: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve(answer()).then(resolve, reject);
          }
          if (typeof prop === "symbol") return undefined;
          return (...args: unknown[]) => {
            q.chain.push(prop);
            if (prop === "from") q.table = args[0];
            if (prop === "values" || prop === "set") q.values = args[0] as Record<string, unknown>;
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
  const audits = () =>
    queries.filter((q) => q.op === "insert" && q.table === mcpAuditLog).map((q) => q.values ?? {});
  return { db, queries, audits };
}

const LEGACY_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

function post(body: unknown, headers: Record<string, string> = {}, raw?: string): NextRequest {
  return new NextRequest(URL_MCP, {
    method: "POST",
    headers: { ...LEGACY_HEADERS, ...headers },
    body: raw ?? JSON.stringify(body),
  });
}

function auth(raw: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${raw}`,
    "cf-connecting-ip": `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
    "cf-ipcountry": "KR",
    ...extra,
  };
}

function rpc(method: string, params: Record<string, unknown> = {}, id = 1) {
  return { jsonrpc: "2.0", id, method, params };
}

function setup(options: TokenOptions = {}) {
  const token = makeToken(options);
  const fake = fakeDb(token.row);
  const deps: McpHttpDeps = {
    db: fake.db,
    now: () => new Date("2026-11-13T00:00:00Z"),
    tools: TOOLS,
  };
  return { ...token, ...fake, deps };
}

beforeEach(() => {
  vi.mocked(onDenied).mockClear();
});

describe("route verbs", () => {
  it("answers GET and DELETE with 405 and Allow: POST", async () => {
    for (const handler of [GET, DELETE]) {
      const response = await handler();
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });
});

describe("gate", () => {
  it("rejects a foreign browser Origin before touching the DB", async () => {
    const { deps, queries, raw } = setup();
    const response = await handleMcpPost(
      post(rpc("tools/list"), auth(raw, { origin: "https://evil.example" })),
      deps
    );
    expect(response.status).toBe(403);
    expect(queries).toHaveLength(0);
  });

  it("returns 413 for a body over 64KB", async () => {
    const { deps, queries, raw } = setup();
    const big = JSON.stringify({ ...rpc("tools/list"), pad: "x".repeat(MCP_MAX_BODY_BYTES) });
    const response = await handleMcpPost(post(null, auth(raw), big), deps);
    expect(response.status).toBe(413);
    expect(queries).toHaveLength(0);
  });

  it("401s an unrecognized token with WWW-Authenticate and an aggregated audit row", async () => {
    const { deps, audits } = setup();
    const response = await handleMcpPost(
      post(rpc("tools/list"), { "cf-connecting-ip": "192.0.2.10", "cf-ipcountry": "KR" }),
      deps
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toMatch(/^Bearer /);
    expect(audits()).toEqual([
      expect.objectContaining({
        userId: OWNER,
        tokenId: null,
        denyReason: "token_unrecognized",
        ip: "192.0.2.10",
        hitCount: 1,
      }),
    ]);
    expect(onDenied).not.toHaveBeenCalled();
  });

  it.each([
    ["token_revoked", { revokedAt: new Date("2026-11-01T00:00:00Z") }],
    ["token_expired", { expiresAt: new Date("2026-11-01T00:00:00Z") }],
  ])("401s a %s token with one denial row per request and an alert", async (reason, options) => {
    const { deps, audits, raw, row } = setup(options);
    const response = await handleMcpPost(post(rpc("tools/list"), auth(raw)), deps);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(audits()).toEqual([
      expect.objectContaining({ tokenId: row.id, outcome: "denied", denyReason: reason }),
    ]);
    expect(onDenied).toHaveBeenCalledWith(expect.objectContaining({ reason, tokenId: row.id }));
  });

  it("429s the 61st call of a token with Retry-After, without an audit row", async () => {
    const { deps, raw, audits } = setup();
    const headers = auth(raw);
    for (let i = 0; i < 60; i++) {
      const ok = await handleMcpPost(post(rpc("ping", {}, i), headers), deps);
      expect(ok.status).not.toBe(429);
    }
    const before = audits().length;
    const response = await handleMcpPost(post(rpc("ping"), headers), deps);
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(audits().length).toBe(before);
  });

  it("403s a lock violation, records it and fires the alert hook", async () => {
    const { deps, raw, audits, row } = setup({ countries: ["KR"] });
    const response = await handleMcpPost(
      post(rpc("tools/list"), auth(raw, { "cf-ipcountry": "US" })),
      deps
    );
    expect(response.status).toBe(403);
    expect(audits()).toEqual([
      expect.objectContaining({
        tokenId: row.id,
        denyReason: "country_not_allowed",
        country: "US",
      }),
    ]);
    expect(onDenied).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "country_not_allowed", tokenName: "테스트 에이전트" })
    );
  });

  it("403s a CIDR-locked token when CF-Connecting-IP is missing", async () => {
    const { deps, raw, audits } = setup({ cidrs: ["203.0.113.0/24"] });
    const response = await handleMcpPost(
      post(rpc("tools/list"), { authorization: `Bearer ${raw}` }),
      deps
    );
    expect(response.status).toBe(403);
    expect(audits()[0]).toMatchObject({ denyReason: "ip_unknown" });
  });

  it("lock-denied flood is charged per IP, never to the token's bucket", async () => {
    const { deps, raw, audits } = setup({ cidrs: ["198.51.100.0/24"] });
    const blocked = { authorization: `Bearer ${raw}`, "cf-connecting-ip": "192.0.2.77" };
    for (let i = 0; i < 60; i++) {
      const denied = await handleMcpPost(post(rpc("ping", {}, i), blocked), deps);
      expect(denied.status).toBe(403);
    }
    const flood = await handleMcpPost(post(rpc("ping"), blocked), deps);
    expect(flood.status).toBe(429);
    expect(audits()).toHaveLength(60);
    expect(onDenied).toHaveBeenCalledTimes(60);

    const owner = await handleMcpPost(post(rpc("tools/list"), auth(raw)), deps);
    expect(owner.status).toBe(200);
    expect((await owner.json()).result.tools).toBeDefined();
  });

  it("answers an unparseable body with a JSON-RPC parse error", async () => {
    const { deps, raw } = setup();
    const response = await handleMcpPost(post(null, auth(raw), "{not json"), deps);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(-32700);
  });
});

describe("scope (AE2)", () => {
  it("read token: tools/list omits write and sensitive tools", async () => {
    const { deps, raw } = setup({ scopes: ["read"] });
    const response = await handleMcpPost(post(rpc("tools/list"), auth(raw)), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.result.tools.map((t: { name: string }) => t.name)).toEqual(["whoami"]);
  });

  it("write+read token lists tools in deterministic registry order with annotations", async () => {
    const { deps, raw } = setup({ scopes: ["write", "read", "sensitive-read"] });
    const first = await (await handleMcpPost(post(rpc("tools/list"), auth(raw)), deps)).json();
    const second = await (await handleMcpPost(post(rpc("tools/list"), auth(raw)), deps)).json();
    const names = first.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(["whoami", "fake_sensitive", "fake_write"]);
    expect(second.result.tools.map((t: { name: string }) => t.name)).toEqual(names);
    const write = first.result.tools.find((t: { name: string }) => t.name === "fake_write");
    expect(write.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  });

  it("read token calling a write tool: JSON-RPC error + scope_denied audit, tool never runs", async () => {
    const { deps, raw, audits, row } = setup({ scopes: ["read"] });
    const response = await handleMcpPost(
      post(rpc("tools/call", { name: "fake_write", arguments: {} }, 7), auth(raw)),
      deps
    );
    const body = await response.json();
    expect(body).toMatchObject({ id: 7, error: { data: { reason: "scope_denied" } } });
    expect(body.result).toBeUndefined();
    expect(audits()).toEqual([
      expect.objectContaining({
        tokenId: row.id,
        outcome: "denied",
        denyReason: "scope_denied",
        tool: "fake_write",
      }),
    ]);
    expect(onDenied).toHaveBeenCalledWith(expect.objectContaining({ reason: "scope_denied" }));
  });

  it("an unknown tool name is the SDK's not-found, not scope_denied", async () => {
    const { deps, raw, audits } = setup({ scopes: ["read"] });
    const response = await handleMcpPost(
      post(rpc("tools/call", { name: "drop_database", arguments: {} }), auth(raw)),
      deps
    );
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("scope_denied");
    expect(body.error ?? body.result?.isError).toBeTruthy();
    expect(audits()).toEqual([]);
    expect(onDenied).not.toHaveBeenCalled();
  });

  it("a batch of 50 denied calls writes one audit row and fires one alert", async () => {
    const { deps, raw, audits, row } = setup({ scopes: ["read"] });
    const batch = Array.from({ length: 50 }, (_, i) =>
      rpc("tools/call", { name: i % 2 ? "fake_write" : "fake_sensitive", arguments: {} }, i)
    );
    const response = await handleMcpPost(post(batch, auth(raw)), deps);
    const body = await response.json();
    expect(body).toHaveLength(50);
    expect(
      body.every(
        (m: { error?: { data?: { reason?: string } } }) => m.error?.data?.reason === "scope_denied"
      )
    ).toBe(true);
    expect(audits()).toEqual([
      expect.objectContaining({
        tokenId: row.id,
        denyReason: "scope_denied",
        tool: null,
        argsSummary: {
          batch: true,
          deniedCount: 50,
          deniedTools: ["fake_sensitive", "fake_write"],
          deniedToolsTruncated: false,
        },
      }),
    ]);
    expect(onDenied).toHaveBeenCalledTimes(1);
    expect(vi.mocked(onDenied).mock.calls[0][0]).not.toHaveProperty("argsSummary");
  });

  it("rejects an oversized batch before any scope audit", async () => {
    const { deps, raw, audits } = setup({ scopes: ["read"] });
    const batch = Array.from({ length: MCP_MAX_BATCH_MESSAGES + 1 }, (_, i) =>
      rpc("tools/call", { name: "fake_write", arguments: {} }, i)
    );
    const response = await handleMcpPost(post(batch, auth(raw)), deps);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ id: null, error: { code: -32600 } });
    expect(audits()).toEqual([]);
    expect(onDenied).not.toHaveBeenCalled();
  });

  it("a mixed batch answers every id: scope_denied for denied calls, rejection for the rest", async () => {
    const { deps, raw, audits } = setup({ scopes: ["read"] });
    const batch = [
      rpc("tools/call", { name: "whoami", arguments: {} }, "a"),
      rpc("tools/call", { name: "fake_write", arguments: {} }, "b"),
      rpc("tools/list", {}, 3),
      { jsonrpc: "2.0", method: "notifications/initialized" },
    ];
    const response = await handleMcpPost(post(batch, auth(raw)), deps);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.map((m: { id: unknown }) => m.id)).toEqual(["a", "b", 3]);
    expect(body[1].error.data.reason).toBe("scope_denied");
    for (const answer of [body[0], body[2]]) {
      expect(answer.result).toBeUndefined();
      expect(answer.error.data.reason).toBe("batch_rejected");
    }
    expect(audits()).toEqual([expect.objectContaining({ tool: "fake_write" })]);
    expect(onDenied).toHaveBeenCalledTimes(1);
  });

  it("a write-scoped token can call the write tool", async () => {
    const { deps, raw } = setup({ scopes: ["write"] });
    const body = await (
      await handleMcpPost(
        post(rpc("tools/call", { name: "fake_write", arguments: {} }), auth(raw)),
        deps
      )
    ).json();
    expect(body.result.structuredContent).toEqual({ written: true });
  });
});

describe("end to end with the SDK client", () => {
  function connect(deps: McpHttpDeps, raw: string, pinModern: boolean) {
    const headers = auth(raw);
    const transport = new StreamableHTTPClientTransport(new URL(URL_MCP), {
      requestInit: { headers },
      fetch: async (input, init) => {
        const request = new NextRequest(String(input instanceof Request ? input.url : input), {
          ...init,
          headers: new Headers(init?.headers),
        } as ConstructorParameters<typeof NextRequest>[1]);
        const response = await handleMcpPost(request, deps);
        expect(response.headers.get("content-type") ?? "").not.toContain("text/event-stream");
        return response;
      },
    });
    const client = new Client(
      { name: "cistory-test", version: "1.0.0" },
      pinModern ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {}
    );
    return { client, transport };
  }

  it.each([
    ["legacy (2025-era initialize)", false],
    ["modern (2026-07-28)", true],
  ])("%s: initialize → tools/list → tools/call whoami over JSON", async (_label, modern) => {
    const { deps, raw, audits } = setup({ scopes: ["read"] });
    const { client, transport } = connect(deps, raw, modern);
    await client.connect(transport);

    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name)).toEqual(["whoami"]);

    const result = await client.callTool({ name: "whoami", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      tokenName: "테스트 에이전트",
      scopes: ["read"],
      serverTime: "2026-11-13T09:00:00+09:00",
      timezone: "Asia/Seoul",
    });
    expect(audits()).toEqual([expect.objectContaining({ tool: "whoami", outcome: "ok" })]);
    expect(JSON.stringify(audits())).not.toContain(raw);

    await client.close();
  });
});
