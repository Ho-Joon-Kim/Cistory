/**
 * Test-only helpers for the MCP tool unit tests: a tool context whose `db` is
 * an inert placeholder (the services it would reach are mocked), and a runner
 * that validates input through the tool's schema like the SDK does.
 */

import type { McpScope } from "@/db/schema";
import type { McpTool, McpToolContext, McpToolOutput } from "../server";

export const TEST_USER_ID = "11111111-1111-4111-8111-111111111111";
export const TEST_DB = { __fake: "db" } as unknown as McpToolContext["db"];

export function toolContext(
  scopes: McpScope[] = ["read"],
  overrides: Partial<McpToolContext> = {}
): McpToolContext {
  return {
    db: TEST_DB,
    userId: TEST_USER_ID,
    tokenId: "22222222-2222-4222-8222-222222222222",
    tokenName: "에이전트",
    scopes,
    ip: "203.0.113.5",
    country: "KR",
    // 2026-11-13 18:00 KST
    now: new Date("2026-11-13T09:00:00Z"),
    ...overrides,
  };
}

/** Parse `input` with the tool's schema (as the SDK would), then run it. */
export async function callTool(
  tool: McpTool,
  input: unknown,
  ctx: McpToolContext = toolContext()
): Promise<McpToolOutput> {
  return tool.run(ctx, tool.inputSchema.parse(input));
}
