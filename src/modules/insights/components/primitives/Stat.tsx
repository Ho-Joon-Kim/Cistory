"use client";

import type * as React from "react";
import { cn } from "@/lib/utils";

export type StatTone = "green" | "amber" | "orange" | "violet" | "blue" | "red" | "neutral";

interface StatProps {
  /** Small uppercase eyebrow label. */
  label: React.ReactNode;
  /** Big numeric value. */
  value: React.ReactNode;
  /** Optional unit shown after value at smaller scale. */
  suffix?: React.ReactNode;
  /** Optional supporting text shown under value. */
  caption?: React.ReactNode;
  /** Color treatment for the value. Default: neutral (foreground). */
  tone?: StatTone;
  /** Compact size for stat strips. */
  size?: "sm" | "md" | "lg";
  /** Glow the value (requires `data-neon` ancestor). */
  glow?: boolean;
  className?: string;
}

const TONE_TEXT: Record<StatTone, string> = {
  green: "glow-text-green",
  amber: "glow-text-amber",
  orange: "glow-text-orange",
  violet: "glow-text-violet",
  blue: "glow-text-blue",
  red: "glow-text-red",
  neutral: "text-foreground",
};

const SIZE_VALUE: Record<NonNullable<StatProps["size"]>, string> = {
  sm: "text-lg",
  md: "text-2xl",
  lg: "text-3xl",
};

const SIZE_SUFFIX: Record<NonNullable<StatProps["size"]>, string> = {
  sm: "text-[10px]",
  md: "text-xs",
  lg: "text-sm",
};

/**
 * Stat — eyebrow label + big tabular-mono value + optional suffix + caption.
 * Used inside InsightCards, in stat strips at the top, and inline with charts.
 */
export function Stat({
  label,
  value,
  suffix,
  caption,
  tone = "neutral",
  size = "md",
  glow = false,
  className,
}: StatProps) {
  const toneClass =
    glow && tone !== "neutral"
      ? TONE_TEXT[tone]
      : tone === "neutral"
        ? "text-foreground"
        : `text-[hsl(var(--accent-${tone}))]`;

  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[10px] uppercase tracking-[0.08em] text-ink-mute">{label}</div>
      <div
        className={cn("mt-1 tabular-mono font-semibold leading-none", SIZE_VALUE[size], toneClass)}
      >
        {value}
        {suffix ? (
          <span className={cn("ml-1 font-normal text-ink-mute", SIZE_SUFFIX[size])}>{suffix}</span>
        ) : null}
      </div>
      {caption ? <div className="mt-1 text-[11px] text-ink-mute">{caption}</div> : null}
    </div>
  );
}
