import type { SourceStatus } from "./types";

/**
 * Why a source needs re-connecting, worded once so /data-status and /settings
 * name the same cause. `legacy_key` (WakaTime only) is WakaTime's retired API-key read path
 * (a stored key with no OAuth connection); `auth` is a confirmed auth refusal.
 */
export type ReauthReason = NonNullable<SourceStatus["reauthReason"]>;

export interface ReauthCopy {
  /** One-line state under the hero title. */
  summary: string;
  /** Popover "오류" row value. */
  error: string;
  /** Short cause clause for the diagnosis sentence. */
  cause: string;
  /** Full explanation for panels (settings notice, data-status disclosure). */
  panel: string;
}

export function reauthCopy(name: string, reason: ReauthReason | null | undefined): ReauthCopy {
  if (reason === "legacy_key") {
    return {
      summary: "API 키로는 더 이상 가져올 수 없어요. 지금까지 가져온 기록은 그대로 보관돼요.",
      error: "API 키 읽기 중단됨 · OAuth로 다시 연결 필요",
      cause:
        "WakaTime이 API 키로는 기록을 읽을 수 없게 바꿨어요 — OAuth로 다시 연결하면 동기화가 이어져요.",
      panel:
        "WakaTime이 API 키로는 기록을 읽을 수 없게 바꿔서 동기화가 멈췄어요. OAuth로 다시 연결하면 이어서 가져오고, 이미 가져온 기록은 그대로예요.",
    };
  }
  return {
    summary: "연결 인증이 끊겼어요. 지금까지 가져온 기록은 그대로 보관돼요.",
    error: "제공자가 인증을 거부함 · 다시 연결 필요",
    cause: "제공자가 인증을 거부했어요 — 다시 연결하면 동기화가 이어져요.",
    panel: `${name} 인증이 만료돼 제공자가 요청을 거부하고 있어요. 다시 연결하면 동기화가 이어지고, 이미 가져온 기록은 그대로예요.`,
  };
}
