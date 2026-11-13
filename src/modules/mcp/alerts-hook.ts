/**
 * Hook point for owner alerts (U10). Every MCP denial by a recognized token —
 * lock violation (ip/country), revoked/expired token use, scope denial,
 * revoked mid-flight — calls `onDenied` after its audit row is written.
 *
 * It hands the event to `alerts.ts`, which sends a Telegram alert (debounced
 * in `mcp_alert_state`) after the current request's work. It must stay
 * fire-and-forget: never throw, never await on the request path, and never
 * put arguments or data in the message.
 */

import { scheduleMcpAlert } from "./alerts";
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

export function onDenied(event: McpDeniedEvent): void {
  try {
    scheduleMcpAlert(event);
  } catch {
    // Alerts are best-effort; a denial response must never fail because of them.
  }
}
