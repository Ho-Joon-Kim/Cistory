"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A ranked row whose share bar sits behind the label (Main "순위 비중 행"):
 * label left, value (--ink2) and percent right; the bar grows from the left.
 * Neutral (--track) by default; pass `color` (e.g. categoryColor("food")) for an
 * 11% tint of it. Hosts set `evidence` from useEvidence().stateOf(key).
 */
export function ShareRow({
  label,
  value,
  pct,
  share,
  leading,
  count,
  color,
  evidence,
  selected,
  emphasis = "pct",
  className,
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  label: ReactNode;
  /** Formatted amount/distance ("1,800,000원"). */
  value?: ReactNode;
  /** Formatted share ("52%"). */
  pct?: ReactNode;
  /** Bar width as a 0..1 ratio (of the top row or of the total — host decides). */
  share: number;
  /** Icon before the label (CategoryMark size="sm"). */
  leading?: ReactNode;
  /** Small count after the label ("3건"). */
  count?: ReactNode;
  color?: string;
  evidence?: "on" | "dim";
  selected?: boolean;
  /** Which figure leads: "pct" (default: bold ink %, --ink2 value) or "value"
   * (bold ink amount, light 12px % — the spending category list). */
  emphasis?: "pct" | "value";
  className?: string;
}) {
  const width = `${Math.max(0, Math.min(1, share)) * 100}%`;
  return (
    <div
      {...rest}
      data-evidence={evidence}
      className={cn(
        "relative flex h-9 items-center justify-between gap-3 rounded-lg px-2.5 text-[13px]",
        selected && "bg-sunken",
        className
      )}
    >
      <span
        aria-hidden="true"
        className="ds-growx absolute inset-y-1 left-0 rounded-[6px]"
        style={{
          width,
          background: color ? `color-mix(in oklab, ${color} 11%, transparent)` : "var(--track)",
        }}
      />
      <span className="relative flex min-w-0 items-center gap-2.5 font-medium text-ink">
        {leading}
        <span className="truncate">{label}</span>
        {count ? <span className="num text-xs font-normal text-ink-3">{count}</span> : null}
      </span>
      <span className="relative flex shrink-0 items-center gap-3">
        {value ? (
          <span
            className={cn("num", emphasis === "value" ? "font-semibold text-ink" : "text-ink-2")}
          >
            {value}
          </span>
        ) : null}
        {pct ? (
          <span
            className={cn(
              "num w-11 text-right",
              emphasis === "value" ? "text-xs font-normal text-ink-3" : "font-semibold text-ink"
            )}
          >
            {pct}
          </span>
        ) : null}
      </span>
    </div>
  );
}
