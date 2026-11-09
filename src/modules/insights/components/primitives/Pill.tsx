"use client";

import type * as React from "react";
import { cn } from "@/lib/utils";

export type PillTone =
  | "green"
  | "amber"
  | "orange"
  | "violet"
  | "blue"
  | "red"
  | "gain"
  | "loss"
  | "neutral";

const PILL_BG: Record<PillTone, string> = {
  green:
    "bg-[hsl(var(--accent-green)/0.12)] text-[hsl(var(--accent-green))] border-[hsl(var(--accent-green)/0.3)]",
  amber:
    "bg-[hsl(var(--accent-amber)/0.12)] text-[hsl(var(--accent-amber))] border-[hsl(var(--accent-amber)/0.3)]",
  orange:
    "bg-[hsl(var(--accent-orange)/0.12)] text-[hsl(var(--accent-orange))] border-[hsl(var(--accent-orange)/0.3)]",
  violet:
    "bg-[hsl(var(--accent-violet)/0.12)] text-[hsl(var(--accent-violet))] border-[hsl(var(--accent-violet)/0.3)]",
  blue: "bg-[hsl(var(--accent-blue)/0.12)] text-[hsl(var(--accent-blue))] border-[hsl(var(--accent-blue)/0.3)]",
  red: "bg-[hsl(var(--accent-red)/0.12)] text-[hsl(var(--accent-red))] border-[hsl(var(--accent-red)/0.3)]",
  /** Investment gain (red, Korean convention). */
  gain: "bg-gain/12 text-gain border-gain/30",
  /** Investment loss (blue, Korean convention). */
  loss: "bg-loss/12 text-loss border-loss/30",
  neutral: "bg-muted/40 text-ink-dim border-hairline",
};

interface PillProps extends React.ComponentProps<"span"> {
  tone?: PillTone;
}

/** Small rounded chip — used for tags, badges, segment labels. */
export function Pill({ tone = "neutral", className, children, ...props }: PillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-mono",
        PILL_BG[tone],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
