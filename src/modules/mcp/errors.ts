/**
 * Errors MCP tools throw on purpose. The tool wrapper (server.ts) turns a
 * `McpToolError` into an `isError: true` tool result carrying its Korean
 * message; any other error becomes a generic message, so DB/driver error text
 * (which can embed query parameters) never reaches the agent.
 */

export class McpToolError extends Error {
  readonly code: string;

  constructor(message: string, code = "tool_error") {
    super(message);
    this.name = "McpToolError";
    this.code = code;
  }
}

/** Bad agent input the schema couldn't catch (time format, range, …). */
export class McpInputError extends McpToolError {
  constructor(message: string, code = "invalid_input") {
    super(message, code);
    this.name = "McpInputError";
  }
}

/**
 * Thrown by the write-audit hook (server.ts `writeAuditHook`) when the token
 * was revoked or expired while the write was in flight. It aborts the write's
 * transaction; the wrapper then records a separate `revoked_midflight` denial.
 */
export class RevokedMidflightError extends Error {
  constructor() {
    super("토큰이 폐기되어 변경을 취소했습니다.");
    this.name = "RevokedMidflightError";
  }
}
