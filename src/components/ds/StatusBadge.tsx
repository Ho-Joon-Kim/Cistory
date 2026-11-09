import { cn } from "@/lib/utils";
import { SOURCE_STATUS_LABELS, type SourceStatus } from "./status";

/**
 * 정상 · 지연 · 실패 · 재인증 필요 · 미연결. A dot + label; only 실패 and 재인증 필요
 * carry a stroke icon. Same colors everywhere: 정상 brand dot, 지연 warn dot, 실패
 * gain (red) text, 재인증 warn text, 미연결 hollow dot in --ink3.
 */
export function StatusBadge({
  status,
  label,
  className,
}: {
  status: SourceStatus;
  /** Override the default Korean label (rare). */
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full bg-surface px-[9px] text-xs font-medium whitespace-nowrap",
        status === "failed"
          ? "text-gain shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--up)_30%,transparent)]"
          : "shadow-[inset_0_0_0_1px_var(--line)]",
        status === "reauth" && "text-warn",
        status === "disconnected" && "text-ink-3",
        (status === "ok" || status === "delayed") && "text-ink",
        className
      )}
    >
      {status === "failed" ? (
        <svg
          aria-hidden="true"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5v5" />
          <path d="M12 16.2v.3" />
        </svg>
      ) : status === "reauth" ? (
        <svg
          aria-hidden="true"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="8" cy="15" r="4" />
          <path d="M11 12l9-9M17 6l3 3" />
        </svg>
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 flex-none rounded-full",
            status === "ok" && "bg-brand",
            status === "delayed" && "bg-warn",
            status === "disconnected" && "shadow-[inset_0_0_0_1.5px_var(--ink3)]"
          )}
        />
      )}
      {label ?? SOURCE_STATUS_LABELS[status]}
    </span>
  );
}
