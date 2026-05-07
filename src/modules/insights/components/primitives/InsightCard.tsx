"use client";

import type * as React from "react";
import { cn } from "@/lib/utils";

export type SchemaTone = "commits" | "coding" | "location" | "transport" | "spending" | "cross";

interface InsightCardProps extends Omit<React.ComponentProps<"section">, "title"> {
  /** Schema this card pulls from — drives the colored left-edge accent. */
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
 * Uses the `.insight-card` utility from globals.patch.css for hairline border,
 * hover lift, and the schema-tone left edge.
 *
 * Pairs with `data-neon` on the page root (set in app/insights/page.tsx).
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
      className={cn("insight-card", padded && "p-6", className)}
      {...props}
    >
      <header className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight text-foreground">{title}</h3>
          {subtitle ? (
            <p className="mt-1 text-xs text-ink-mute leading-relaxed">{subtitle}</p>
          ) : null}
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
    <div
      className="animate-shimmer rounded-md"
      style={{ height: `${height}px` }}
      aria-label="loading"
    />
  );
}
