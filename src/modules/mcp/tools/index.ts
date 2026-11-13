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
import { HEALTH_TOOLS } from "./health";
import { LOCATION_TOOLS } from "./location";
import { META_TOOLS } from "./meta";
import { OVERVIEW_SEARCH_TOOLS } from "./overview-search";
import { PHOTOS_TOOLS } from "./photos";
import { PLACES_TRIPS_TOOLS } from "./places-trips";
import { PORTFOLIO_TOOLS } from "./portfolio";
import { REBALANCE_TOOLS } from "./rebalance";
import { SPENDING_TOOLS } from "./spending";
import { TRAVEL_TIME_TOOLS } from "./travel-time";
import { WORK_TOOLS } from "./work";
import { WRITE_TOOLS } from "./writes";

export const ALL_TOOLS: readonly McpTool[] = [
  ...META_TOOLS,
  ...LOCATION_TOOLS,
  ...PLACES_TRIPS_TOOLS,
  ...SPENDING_TOOLS,
  ...HEALTH_TOOLS,
  ...WORK_TOOLS,
  ...PORTFOLIO_TOOLS,
  ...OVERVIEW_SEARCH_TOOLS,
  ...PHOTOS_TOOLS,
  ...REBALANCE_TOOLS,
  ...TRAVEL_TIME_TOOLS,
  ...WRITE_TOOLS,
];

export function findTool(name: string): McpTool | undefined {
  return ALL_TOOLS.find((tool) => tool.name === name);
}
