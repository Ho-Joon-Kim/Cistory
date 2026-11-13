/**
 * MCP server factory and tool framework.
 *
 * Tools are defined once at module scope (`tools/*.ts`, assembled in
 * `tools/index.ts`) and, per request, only those whose scope the token holds
 * are registered — so `tools/list` never shows a tool the token can't call.
 * The wrapper re-checks the scope anyway (annotations are hints, not access
 * control), then:
 *
 *  - read tools: audit row first (fail-closed, `auditedRead`) → run → result
 *    (already allowlist-serialized by the tool via serialize.ts; Dates are
 *    rendered +09:00 here as a safety net) → result count.
 *  - write tools: NO pre-audit. The tool runs its service write with an
 *    `inTx` hook from `writeAuditHook`, which re-checks the token under
 *    `FOR SHARE` and records the before/after audit inside the write's own
 *    transaction (U9). A revocation seen there aborts the transaction and the
 *    wrapper records a separate `revoked_midflight` denial. Any other failure
 *    (after the rollback) gets one `error` row with the summarized args and a
 *    code, never the message (`recordWriteFailure`, R28).
 *
 * Errors: `McpToolError` (and 4xx `ApiError` from services) become
 * `isError: true` results with their Korean message; anything else becomes a
 * generic Korean message and a log line without the error text (DB errors
 * embed query parameters).
 */

import type { CallToolResult, ContentBlock } from "@modelcontextprotocol/server";
import { McpServer } from "@modelcontextprotocol/server";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { Database } from "@/db";
import { type McpScope, mcpTokens } from "@/db/schema";
import { ApiError } from "@/lib/api-handler";
import { logger } from "@/lib/logger";
import { onDenied } from "./alerts-hook";
import {
  type ArgRules,
  auditedRead,
  type McpAuditContext,
  McpAuditError,
  recordDenial,
  recordWriteAudit,
  recordWriteFailure,
  summarizeArgs,
} from "./audit";
import { McpToolError, RevokedMidflightError } from "./errors";
import { toJsonValue } from "./serialize";

export const MCP_SERVER_NAME = "cistory";
export const MCP_SERVER_VERSION = "1.0.0";
/** Upper bound on one tool result's JSON text (the plan's ~200KB response cap). */
export const MCP_MAX_RESULT_BYTES = 200 * 1024;

const SERVER_INSTRUCTIONS =
  "Cistory 개인 기록 서버입니다. 모든 시각은 +09:00(한국 시간) 오프셋으로 반환됩니다. " +
  "입력 날짜 YYYY-MM-DD는 한국 시간 하루로 해석하고, 시각은 오프셋(Z 또는 +09:00)이 있어야 합니다. " +
  "조회 기간은 최대 366일입니다.";

const GENERIC_ERROR = "요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.";

/** Per-request context every tool receives. Built by the route after the gate. */
export interface McpToolContext {
  db: Database;
  userId: string;
  tokenId: string;
  tokenName: string;
  scopes: McpScope[];
  ip: string | null;
  country: string | null;
  /** Request start; use for "now"-relative defaults so one call is consistent. */
  now: Date;
}

/** Explicit on every tool. Hints only — access control is the scope. */
export interface McpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

/** What a tool's `run` returns. `structured` must already be allowlist-serialized. */
export interface McpToolOutput {
  structured: Record<string, unknown>;
  /** Rows returned, for the audit log (null when not a list). */
  count?: number | null;
  /** Extra content blocks after the JSON text (e.g. images for photo_thumbnails). */
  content?: ContentBlock[];
}

type ToolKind = "read" | "write";

interface ToolDefinitionBase<Input extends z.ZodObject> {
  /** snake_case, unique across ALL_TOOLS. */
  name: string;
  title: string;
  description: string;
  /** The scope the token must hold. A write tool's scope is always `write`. */
  scope: McpScope;
  annotations: McpToolAnnotations;
  inputSchema: Input;
  outputSchema?: z.ZodObject;
  /** Audit summarizer rules for the arguments (see audit.ts `summarizeArgs`). */
  argRules?: ArgRules;
  run: (ctx: McpToolContext, input: z.output<Input>) => Promise<McpToolOutput>;
}

export type McpToolDefinition<Input extends z.ZodObject> = ToolDefinitionBase<Input> & {
  kind: ToolKind;
};

/** A registry entry with its input type erased (see `defineTool`). */
export interface McpTool {
  name: string;
  title: string;
  description: string;
  scope: McpScope;
  kind: ToolKind;
  annotations: McpToolAnnotations;
  inputSchema: z.ZodObject;
  outputSchema?: z.ZodObject;
  argRules?: ArgRules;
  run: (ctx: McpToolContext, input: unknown) => Promise<McpToolOutput>;
}

/** Define a tool with `run`'s input inferred from its schema, then erase for the registry. */
export function defineTool<Input extends z.ZodObject>(tool: McpToolDefinition<Input>): McpTool {
  if (tool.kind === "write" && tool.scope !== "write") {
    throw new Error(`MCP write tool ${tool.name} must require the write scope`);
  }
  if (tool.kind === "read" && tool.scope === "write") {
    throw new Error(`MCP read tool ${tool.name} must not require the write scope`);
  }
  return tool as unknown as McpTool;
}

export function toolsForScopes(tools: readonly McpTool[], scopes: readonly McpScope[]): McpTool[] {
  return tools.filter((tool) => scopes.includes(tool.scope));
}

function auditContext(ctx: McpToolContext): McpAuditContext {
  return { userId: ctx.userId, tokenId: ctx.tokenId, ip: ctx.ip, country: ctx.country };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function finalize(output: McpToolOutput): { result: CallToolResult; count: number | null } {
  const structured = toJsonValue(output.structured) as Record<string, unknown>;
  const text = JSON.stringify(structured);
  if (Buffer.byteLength(text, "utf8") > MCP_MAX_RESULT_BYTES) {
    throw new McpToolError(
      "응답이 너무 큽니다. 기간을 줄이거나 limit을 낮춰 다시 요청하세요.",
      "result_too_large"
    );
  }
  return {
    result: {
      content: [{ type: "text", text }, ...(output.content ?? [])],
      structuredContent: structured,
    },
    count: output.count ?? null,
  };
}

async function denyRevokedMidflight(
  tool: McpTool,
  ctx: McpToolContext,
  input: unknown
): Promise<CallToolResult> {
  const denial = {
    userId: ctx.userId,
    tokenId: ctx.tokenId,
    reason: "revoked_midflight" as const,
    ip: ctx.ip,
    country: ctx.country,
    tool: tool.name,
    argsSummary: summarizeArgs(input, tool.argRules),
  };
  await recordDenial(ctx.db, denial);
  onDenied({ ...denial, tokenName: ctx.tokenName });
  return errorResult(new RevokedMidflightError().message);
}

function toErrorResult(error: unknown, tool: McpTool): CallToolResult {
  if (error instanceof McpToolError) return errorResult(error.message);
  if (error instanceof McpAuditError) return errorResult(error.message);
  if (error instanceof ApiError && error.status < 500) return errorResult(error.message);
  logger.error("[MCP] tool failed", {
    tool: tool.name,
    errorName: error instanceof Error ? error.name : typeof error,
    code:
      typeof (error as { code?: unknown })?.code === "string"
        ? (error as { code: string }).code
        : null,
  });
  return errorResult(GENERIC_ERROR);
}

/**
 * The audit code for a failed write: only codes we assign ourselves (tool
 * errors, 4xx ApiError codes, the audit failure). Any other error — notably a
 * DB/driver error, whose `code` is a SQLSTATE — is recorded as `tool_error`.
 */
function writeErrorCode(error: unknown): string {
  if (error instanceof McpToolError) return error.code;
  if (error instanceof McpAuditError) return "audit_failed";
  if (error instanceof ApiError && error.status < 500) return error.code ?? `http_${error.status}`;
  return "tool_error";
}

/**
 * The tool wrapper. Never throws: every failure is an `isError` result, so the
 * SDK's own catch (which would echo `error.message`) is never reached.
 */
export async function runTool(
  tool: McpTool,
  ctx: McpToolContext,
  input: unknown
): Promise<CallToolResult> {
  if (!ctx.scopes.includes(tool.scope)) {
    // Unreachable through the factory (unregistered tools aren't callable);
    // kept as defense in depth.
    const denial = {
      userId: ctx.userId,
      tokenId: ctx.tokenId,
      reason: "scope_denied" as const,
      ip: ctx.ip,
      country: ctx.country,
      tool: tool.name,
    };
    await recordDenial(ctx.db, denial);
    onDenied({ ...denial, tokenName: ctx.tokenName });
    return errorResult("이 토큰에는 이 도구를 호출할 권한이 없습니다.");
  }

  try {
    if (tool.kind === "read") {
      const { result } = await auditedRead(
        ctx.db,
        auditContext(ctx),
        { tool: tool.name, argsSummary: summarizeArgs(input, tool.argRules) },
        async () => finalize(await tool.run(ctx, input)),
        (out) => out.count
      );
      return result;
    }
    let output: McpToolOutput;
    try {
      output = await tool.run(ctx, input);
    } catch (error) {
      if (!(error instanceof RevokedMidflightError)) {
        await recordWriteFailure(ctx.db, auditContext(ctx), {
          tool: tool.name,
          argsSummary: summarizeArgs(input, tool.argRules),
          errorCode: writeErrorCode(error),
        });
      }
      throw error;
    }
    return finalize(output).result;
  } catch (error) {
    if (error instanceof RevokedMidflightError) return denyRevokedMidflight(tool, ctx, input);
    return toErrorResult(error, tool);
  }
}

// ── Write audit hook ─────────────────────────────────────────────────────────

/** The transaction surface the hook needs (a Drizzle `tx` satisfies it). */
export type McpWriteTx = Pick<Database, "select" | "insert">;

export interface WriteChange {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  resultCount?: number | null;
}

/**
 * Build the `inTx(tx, { before, after })` callback a write tool hands to its
 * service write. Runs inside the write's transaction right before commit:
 * reads the token row `FOR SHARE` (a concurrent revoke waits for this commit)
 * and throws `RevokedMidflightError` if it's gone, revoked or expired; then
 * records the write audit with only `fields` of before/after. Either throw
 * rolls the write back.
 */
export function writeAuditHook(
  ctx: McpToolContext,
  write: { tool: string; args: unknown; argRules?: ArgRules; fields: readonly string[] }
): (tx: McpWriteTx, change: WriteChange) => Promise<void> {
  return async (tx, change) => {
    const [token] = await tx
      .select({ revokedAt: mcpTokens.revokedAt, expiresAt: mcpTokens.expiresAt })
      .from(mcpTokens)
      .where(eq(mcpTokens.id, ctx.tokenId))
      .for("share");
    const now = new Date();
    if (
      !token ||
      token.revokedAt ||
      (token.expiresAt && token.expiresAt.getTime() <= now.getTime())
    ) {
      throw new RevokedMidflightError();
    }
    await recordWriteAudit(tx, auditContext(ctx), {
      tool: write.tool,
      argsSummary: summarizeArgs(write.args, write.argRules),
      fields: write.fields,
      before: change.before,
      after: change.after,
      resultCount: change.resultCount ?? null,
      at: now,
    });
  };
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * A fresh McpServer for one request, with only the tools `ctx.scopes` allows,
 * registered in registry order (deterministic `tools/list`).
 */
export function buildMcpServer(ctx: McpToolContext, tools: readonly McpTool[]): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS }
  );
  for (const tool of toolsForScopes(tools, ctx.scopes)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        annotations: { title: tool.title, ...tool.annotations },
      },
      (input: unknown) => runTool(tool, ctx, input)
    );
  }
  return server;
}
