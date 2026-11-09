/** The one status vocabulary shared by data-status, settings and source rows. */
export type SourceStatus = "ok" | "delayed" | "failed" | "reauth" | "disconnected";

export const SOURCE_STATUS_LABELS: Record<SourceStatus, string> = {
  ok: "정상",
  delayed: "지연",
  failed: "실패",
  reauth: "재인증 필요",
  disconnected: "미연결",
};

/** A connected source with no success for this long is 지연. */
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

/**
 * Status precedence: never connected → 미연결; provider rejected the token →
 * 재인증 필요; last attempt errored → 실패; no success within 48h → 지연; else 정상.
 */
export function deriveSourceStatus(input: {
  connected: boolean;
  needsReauth?: boolean;
  lastError?: string | null;
  lastSuccessAt?: Date | string | null;
  now?: Date;
}): SourceStatus {
  if (!input.connected) return "disconnected";
  if (input.needsReauth) return "reauth";
  if (input.lastError) return "failed";
  const now = input.now ?? new Date();
  const last = input.lastSuccessAt ? new Date(input.lastSuccessAt) : null;
  if (!last || Number.isNaN(last.getTime()) || now.getTime() - last.getTime() > STALE_AFTER_MS) {
    return "delayed";
  }
  return "ok";
}
