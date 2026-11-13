/**
 * The full MCP tool registry. Each domain module exports one array
 * (`<DOMAIN>_TOOLS: McpTool[]`, built with `defineTool`) and is appended here;
 * the order of this list is the `tools/list` order. Tool names must be unique
 * (pinned by tools/index.test.ts).
 *
 * The route also checks `tools/call` names against this list: a name that
 * exists here but is outside the token's scopes is a `scope_denied`, a name
 * that doesn't exist is left to the SDK's "not found".
 */

import type { McpTool } from "../server";
import { META_TOOLS } from "./meta";

export const ALL_TOOLS: readonly McpTool[] = [...META_TOOLS];

export function findTool(name: string): McpTool | undefined {
  return ALL_TOOLS.find((tool) => tool.name === name);
}
