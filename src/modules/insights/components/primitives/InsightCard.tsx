"use client";

import type * as React from "react";
import { cn } from "@/lib/utils";

export type SchemaTone = "commits" | "coding" | "location" | "transport" | "spending" | "cross";

interface InsightCardProps extends Omit<React.ComponentProps<"section">, "title"> {
  /** Schema this card pulls from (exposed as data-schema; currently paints nothing). */
  schema?: SchemaTone;
  /** Title (large) shown in header. */
  title: React.ReactNode;
  /** Subtitle / one-line description shown under title. */
  subtitle?: React.ReactNode;
  /** Right-aligned slot in the header (e.g. toggles, period labels). */
  right?: React.ReactNode;
  /** Padding override — defaults to 24px all-around. */
  padded?: boolean;
}

/**
 * Insight card shell — replaces shadcn `<Card>` for the redesigned insights page.
 * Uses the `.insight-card` rule in globals.css for the hairline border and card surface.
 *
 * Pairs with `data-neon` on the page root (/overview, /health).
 */
export function InsightCard({
  schema,
  title,
  subtitle,
  right,
  padded = true,
  className,
  children,
  ...props
}: InsightCardProps) {
  return (
    <section
      data-slot="insight-card"
      data-schema={schema}
      className={cn("insight-card", padded && "px-5 py-[18px]", className)}
      {...props}
    >
      <header className="flex items-start justify-between gap-3 mb-3.5">
        <div className="min-w-0 flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle ? <p className="text-xs text-ink-mute leading-snug">{subtitle}</p> : null}
        </div>
        {right ? <div className="shrink-0 flex items-center gap-2">{right}</div> : null}
      </header>
      {children}
    </section>
  );
}

/**
 * Empty state for cards with no data.
 */
export function InsightCardEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-32 items-center justify-center text-xs text-ink-mute">{message}</div>
  );
}

/**
 * Loading skeleton.
 */
export function InsightCardLoading({ height = 120 }: { height?: number }) {
  return (
    <output
      className="animate-shimmer block rounded-md"
      style={{ height: `${height}px` }}
      aria-label="로딩 중…"
    />
  );
}
