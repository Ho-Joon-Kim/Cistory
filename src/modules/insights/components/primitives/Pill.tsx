"use client";

import type * as React from "react";
import { cn } from "@/lib/utils";

export type PillTone = "green" | "amber" | "orange" | "violet" | "blue" | "red" | "neutral";

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
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-mono",
        PILL_BG[tone],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
