/**
 * The `/api/mcp` request pipeline (route.ts only wires this up — Next route
 * files may export nothing but verbs and config). Order, per the plan's HTD;
 * a rejection at any step stops everything below it:
 *
 *   Origin → body cap (64KB, 413) → token (401, IP-bucket rate limit, audit)
 *   → IP/country lock (403, IP-bucket rate limit, audit, alert hook)
 *   → token rate limit (429) → JSON-RPC parse → batch cap (64 messages)
 *   → scope check of tools/call names (scope_denied, one audit row per request)
 *   → SDK: modern (2026-07-28) via createMcpHandler, legacy (2025-era) via a
 *     stateless JSON-mode transport → Cache-Control: private, no-store.
 *
 * Both eras answer with a single JSON body (no SSE): Cloudflare has cut long
 * streams before. The SDK's built-in stateless legacy fallback always streams
 * (it constructs its transport without `enableJsonResponse`), so the legacy
 * leg is hand-wired with `isLegacyRequest`, as the SDK documents for that case.
 *
 * The raw token never leaves this module: `authInfo.token` is "<redacted>".
 */

import {
  type AuthInfo,
  createMcpHandler,
  isLegacyRequest,
  type McpRequestContext,
  readRequestBody,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import type { NextRequest } from "next/server";
import { type Database, getDb } from "@/db";
import { logger } from "@/lib/logger";
import { type McpDeniedEvent, onDenied } from "./alerts-hook";
import { recordDenial, recordUnauthenticatedDenial } from "./audit";
import {
  type ClientLocation,
  evaluateLock,
  isAllowedOrigin,
  limitTokenRequest,
  limitUnauthenticatedRequest,
  rateLimitedResponse,
  readClientLocation,
} from "./gate";
import { buildMcpServer, type McpTool, type McpToolContext } from "./server";
import { bearerToken, type VerifyMcpTokenResult, verifyToken } from "./tokens";
import { ALL_TOOLS } from "./tools";

export const MCP_MAX_BODY_BYTES = 64 * 1024;
const NO_STORE = "private, no-store";
const JSON_RPC_INVALID_PARAMS = -32602;
const JSON_RPC_PARSE_ERROR = -32700;
const JSON_RPC_INVALID_REQUEST = -32600;
const JSON_RPC_SERVER_ERROR = -32000;
/** Largest JSON-RPC batch accepted; checked before any scope audit. */
export const MCP_MAX_BATCH_MESSAGES = 64;
/** Distinct denied tool names kept in a batch denial's argsSummary. */
const DENIED_TOOLS_SUMMARY_MAX = 10;

export interface McpHttpDeps {
  db?: Database;
  now?: () => Date;
  tools?: readonly McpTool[];
}

interface RequestScope {
  ctx: McpToolContext;
  tools: readonly McpTool[];
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": NO_STORE, ...headers },
  });
}

export function methodNotAllowed(): Response {
  return jsonResponse(
    405,
    { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Method not allowed." } },
    { Allow: "POST" }
  );
}

function unauthorized(invalidToken: boolean): Response {
  return jsonResponse(
    401,
    { error: "유효한 MCP 토큰이 필요합니다." },
    {
      "WWW-Authenticate": invalidToken
        ? 'Bearer realm="cistory-mcp", error="invalid_token"'
        : 'Bearer realm="cistory-mcp"',
    }
  );
}

function withNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", NO_STORE);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ── SDK wiring ───────────────────────────────────────────────────────────────

function scopeFrom(authInfo: AuthInfo | undefined): RequestScope {
  const scope = authInfo?.extra?.cistory as RequestScope | undefined;
  // Only this module calls the handler, always with a scope — so a missing
  // one is a wiring bug, never a request we should serve.
  if (!scope) throw new Error("MCP request reached the SDK without a gated context");
  return scope;
}

function mcpFactory({ authInfo }: McpRequestContext) {
  const { ctx, tools } = scopeFrom(authInfo);
  return buildMcpServer(ctx, tools);
}

function reportSdkError(error: Error): void {
  // Name only: SDK error messages can quote request content.
  logger.warn("[MCP] sdk error", { errorName: error.name });
}

const modernHandler = createMcpHandler(mcpFactory, {
  legacy: "reject",
  responseMode: "json",
  maxRequestBodySize: MCP_MAX_BODY_BYTES,
  onerror: reportSdkError,
});

async function serveLegacy(request: Request, parsedBody: unknown, authInfo: AuthInfo) {
  const server = mcpFactory({ era: "legacy", authInfo, requestInfo: request });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  transport.onerror = reportSdkError;
  await server.connect(transport);
  try {
    return await transport.handleRequest(request, { authInfo, parsedBody });
  } finally {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  }
}

// ── Scope check of tools/call ────────────────────────────────────────────────

interface DeniedCall {
  id: string | number | null;
  tool: string;
  message: unknown;
}

/** The tool name of a `tools/call` request message, else null. */
function toolCallName(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const { method, params } = message as { method?: unknown; params?: unknown };
  if (method !== "tools/call" || !params || typeof params !== "object") return null;
  const name = (params as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

function deniedToolCalls(
  body: unknown,
  scopes: readonly string[],
  tools: readonly McpTool[]
): DeniedCall[] {
  const denied: DeniedCall[] = [];
  for (const message of Array.isArray(body) ? body : [body]) {
    const name = toolCallName(message);
    const tool = name ? tools.find((candidate) => candidate.name === name) : undefined;
    // Unknown names fall through to the SDK's own "not found".
    if (!name || !tool || scopes.includes(tool.scope)) continue;
    const id = (message as { id?: unknown }).id;
    denied.push({
      id: typeof id === "string" || typeof id === "number" ? id : null,
      tool: name,
      message,
    });
  }
  return denied;
}

function rpcId(message: unknown): string | number | null | undefined {
  if (!message || typeof message !== "object" || !("id" in message)) return undefined;
  const id = (message as { id?: unknown }).id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function scopeDeniedError(id: string | number | null, tool: string) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: JSON_RPC_INVALID_PARAMS,
      message: `이 토큰에는 '${tool}' 도구를 호출할 권한이 없습니다.`,
      data: { reason: "scope_denied" },
    },
  };
}

/**
 * A single message gets its own scope_denied error. A batch containing any
 * denied call is rejected as a whole, with an error for every message that
 * carries an id: scope_denied for the denied calls, a generic rejection for
 * the rest (which never ran) — so no request id goes unanswered.
 */
function scopeDeniedResponse(body: unknown, denied: DeniedCall[]): Response {
  if (!Array.isArray(body))
    return jsonResponse(200, scopeDeniedError(denied[0].id, denied[0].tool));
  const answers = body.flatMap((message) => {
    const call = denied.find((candidate) => candidate.message === message);
    if (call) return [scopeDeniedError(call.id, call.tool)];
    const id = rpcId(message);
    if (id === undefined) return [];
    return [
      {
        jsonrpc: "2.0",
        id,
        error: {
          code: JSON_RPC_SERVER_ERROR,
          message: "배치에 권한 밖 호출이 포함되어 전체가 거부되었습니다.",
          data: { reason: "batch_rejected" },
        },
      },
    ];
  });
  return jsonResponse(200, answers);
}

/** One denial per request: distinct tool names, capped, for batch audits. */
function deniedSummary(body: unknown, denied: DeniedCall[]) {
  const distinct = [...new Set(denied.map((call) => call.tool))];
  return {
    tool: distinct.length === 1 ? distinct[0] : null,
    argsSummary: Array.isArray(body)
      ? {
          batch: true,
          deniedCount: denied.length,
          deniedTools: distinct.slice(0, DENIED_TOOLS_SUMMARY_MAX),
          deniedToolsTruncated: distinct.length > DENIED_TOOLS_SUMMARY_MAX,
        }
      : null,
  };
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

export async function handleMcpPost(
  request: NextRequest,
  deps: McpHttpDeps = {}
): Promise<Response> {
  try {
    return await pipeline(request, deps);
  } catch (error) {
    // Fail closed. Name only — DB errors embed query parameters.
    logger.error("[MCP] request failed", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return jsonResponse(500, { error: "요청을 처리하지 못했습니다." });
  }
}

/** Audit a recognized token's denial (one row per request), then the alert hook. */
async function deny(
  db: Database,
  denial: McpDeniedEvent & { at: Date; argsSummary?: Record<string, unknown> | null }
): Promise<void> {
  // argsSummary is audit-only; the alert hook never sees arguments.
  const { argsSummary: _argsSummary, ...event } = denial;
  await recordDenial(db, denial);
  onDenied(event);
}

async function rejectUnverified(
  request: NextRequest,
  db: Database,
  verified: Extract<VerifyMcpTokenResult, { ok: false }>,
  location: ClientLocation,
  now: Date
): Promise<Response> {
  const limited = limitUnauthenticatedRequest(request, location);
  if (!limited.allowed) return rateLimitedResponse(limited.retryAfterSec);
  if (verified.reason === "token_unrecognized" || !verified.userId) {
    await recordUnauthenticatedDenial(db, { reason: verified.reason, ...location, at: now });
    return unauthorized(false);
  }
  await deny(db, {
    userId: verified.userId,
    tokenId: verified.tokenId ?? null,
    reason: verified.reason,
    ...location,
    at: now,
  });
  return unauthorized(true);
}

function parseJsonBody(text: string): unknown {
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function pipeline(request: NextRequest, deps: McpHttpDeps): Promise<Response> {
  if (!isAllowedOrigin(request.headers.get("origin"))) {
    return jsonResponse(403, { error: "허용되지 않은 Origin입니다." });
  }

  const read = await readRequestBody(request, MCP_MAX_BODY_BYTES);
  if (read.tooLarge) {
    return jsonResponse(413, { error: "요청 본문이 너무 큽니다." });
  }

  const db = deps.db ?? getDb();
  const now = deps.now?.() ?? new Date();
  const tools = deps.tools ?? ALL_TOOLS;
  const location = readClientLocation(request.headers);

  const verified = await verifyToken(db, bearerToken(request.headers.get("authorization")), now);
  if (!verified.ok) return rejectUnverified(request, db, verified, location, now);
  const { token } = verified;
  const who = { userId: token.userId, tokenId: token.tokenId, tokenName: token.name };

  // Lock first, and lock-denied requests charge the per-IP bucket, not the
  // token's: a leaked token flooded from outside its lock must not 429 the
  // owner's real agent, and the flood is still throttled (and its audit rows
  // bounded) per IP.
  const lock = evaluateLock({ cidrs: token.cidrs, countries: token.countries }, location);
  if (!lock.allowed) {
    const ipLimited = limitUnauthenticatedRequest(request, location);
    if (!ipLimited.allowed) return rateLimitedResponse(ipLimited.retryAfterSec);
    await deny(db, { ...who, reason: lock.reason, ...location, at: now });
    return jsonResponse(403, { error: "이 위치에서는 이 토큰을 사용할 수 없습니다." });
  }

  const limited = limitTokenRequest(request, token.tokenId);
  if (!limited.allowed) return rateLimitedResponse(limited.retryAfterSec);

  const body = parseJsonBody(read.text);
  if (body === undefined) {
    return jsonResponse(400, {
      jsonrpc: "2.0",
      id: null,
      error: { code: JSON_RPC_PARSE_ERROR, message: "Parse error" },
    });
  }

  if (Array.isArray(body) && body.length > MCP_MAX_BATCH_MESSAGES) {
    return jsonResponse(400, {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: JSON_RPC_INVALID_REQUEST,
        message: `배치는 최대 ${MCP_MAX_BATCH_MESSAGES}개 메시지까지 보낼 수 있습니다.`,
      },
    });
  }

  const denied = deniedToolCalls(body, token.scopes, tools);
  if (denied.length > 0) {
    await deny(db, {
      ...who,
      reason: "scope_denied",
      ...deniedSummary(body, denied),
      ...location,
      at: now,
    });
    return scopeDeniedResponse(body, denied);
  }

  const ctx: McpToolContext = {
    db,
    userId: token.userId,
    tokenId: token.tokenId,
    tokenName: token.name,
    scopes: token.scopes,
    ip: location.ip,
    country: location.country,
    now,
  };
  const authInfo: AuthInfo = {
    token: "<redacted>",
    clientId: token.tokenId,
    scopes: [...token.scopes],
    extra: { cistory: { ctx, tools } satisfies RequestScope },
  };

  const legacy = await isLegacyRequest(request, body, { maxRequestBodySize: MCP_MAX_BODY_BYTES });
  const response = legacy
    ? await serveLegacy(request, body, authInfo)
    : await modernHandler.fetch(request, { authInfo, parsedBody: body });
  return withNoStore(response);
}
