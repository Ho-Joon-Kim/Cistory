"use client";

import { formatCount, formatRelative } from "@/lib/format";
import { DisclosureRow } from "./DisclosureRow";
import { McpAuditLog } from "./McpAuditLog";
import { lockWarnings, McpTokensCard, useMcpTokens } from "./McpTokensCard";

/**
 * The settings 관리 section's two MCP rows (tokens, audit log), mounted as one
 * component so SettingsForm only owns the open/close state.
 */
export function McpSettingsSection({
  open,
  toggle,
  now,
}: {
  open: Record<string, boolean>;
  toggle: (id: string) => () => void;
  now: Date;
}) {
  const tokens = useMcpTokens();
  const meta = mcpMeta(tokens.data, now);
  return (
    <>
      <DisclosureRow
        id="mcp"
        title="MCP 토큰"
        meta={meta?.text ?? "에이전트 접속 토큰 · 스코프 · IP·국가 잠금"}
        metaTone={meta?.warn ? "warn" : "ink3"}
        open={!!open.mcp}
        onToggle={toggle("mcp")}
      >
        <McpTokensCard />
      </DisclosureRow>
      <DisclosureRow
        id="mcp-audit"
        title="MCP 감사 로그"
        meta="토큰 · 도구 · 결과 · 기간별 호출 기록"
        open={!!open["mcp-audit"]}
        onToggle={toggle("mcp-audit")}
      >
        <McpAuditLog />
      </DisclosureRow>
    </>
  );
}

const join = (...parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(" · ");

/** 관리 row subtitle for MCP tokens: active count + latest use, warn when one is unlocked. */
export function mcpMeta(
  tokens: ReturnType<typeof useMcpTokens>["data"],
  now: Date
): { text: string; warn: boolean } | null {
  if (!tokens) return null;
  const active = tokens.filter((t) => t.status === "active");
  if (active.length === 0) return { text: "사용 중인 토큰 없음", warn: false };
  const unlocked = active.filter(
    (t) =>
      lockWarnings({ scopes: t.scopes, cidrs: t.allowedCidrs, countries: t.allowedCountries })
        .noLock
  ).length;
  const lastUsed = active
    .map((t) => t.lastUsedAt)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);
  return {
    text: join(
      `사용 중 ${formatCount(active.length)}개`,
      lastUsed ? `마지막 사용 ${formatRelative(lastUsed, now)}` : "아직 사용 안 함",
      unlocked > 0 && `잠금 없는 토큰 ${formatCount(unlocked)}개`
    ),
    warn: unlocked > 0,
  };
}
