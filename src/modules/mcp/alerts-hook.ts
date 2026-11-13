/**
 * HOOK POINT FOR U10 (owner alerts). Every MCP denial by a recognized token —
 * lock violation (ip/country), revoked/expired token use, scope denial,
 * revoked mid-flight — calls `onDenied` after its audit row is written.
 *
 * Today it is a no-op. U10 replaces the body with the Telegram alert
 * (debounced in `mcp_alert_state`, sent after the response). It must stay
 * fire-and-forget: never throw, never await on the request path, and never
 * put arguments or data in the message.
 */

import type { McpDenyReason } from "./audit";

export interface McpDeniedEvent {
  userId: string;
  tokenId: string | null;
  tokenName?: string | null;
  reason: McpDenyReason;
  ip: string | null;
  country: string | null;
  tool?: string | null;
}

export function onDenied(_event: McpDeniedEvent): void {
  // U10: Telegram alert goes here.
}
