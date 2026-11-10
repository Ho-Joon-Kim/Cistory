"use client";

import type { ReactNode } from "react";
import { AiLine, FactTrigger } from "@/components/ds";
import { cn } from "@/lib/utils";
import type { TravelInsight } from "../list-model";

/** One AI line from a computed {@link TravelInsight}; renders nothing without one. */
export function InsightLine({
  insight,
  className,
  align,
  as,
}: {
  insight: TravelInsight | null | undefined;
  className?: string;
  align?: "start" | "center" | "end";
  as?: "p" | "span" | "div";
}) {
  if (!insight) return null;
  const post = insight.post ?? "";
  const cut = post.search(/\s/);
  const lead = cut < 0 ? post : post.slice(0, cut);
  const rest = cut < 0 ? "" : post.slice(cut);
  return (
    <AiLine evidence={insight.evidence} className={className} as={as}>
      {insight.pre}
      {/* The fact and the particle glued to it ("46%가") never split across lines. */}
      <span className="whitespace-nowrap">
        <FactTrigger rows={insight.rows} note={insight.source} align={align}>
          {insight.trigger}
        </FactTrigger>
        {lead}
      </span>
      {rest}
    </AiLine>
  );
}

export function Chevron({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "transition-[rotate] duration-200 ease-[cubic-bezier(0.2,0,0,1)] in-[[aria-expanded=true]]:rotate-180",
        className
      )}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

/** Height-animated reveal (grid-rows 0fr → 1fr); content stays mounted for a11y ids. */
export function Collapse({
  open,
  id,
  children,
}: {
  open: boolean;
  id?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      data-open={open}
      inert={!open}
      className="grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-250 ease-[cubic-bezier(0.2,0,0,1)] data-[open=true]:grid-rows-[1fr] data-[open=true]:opacity-100"
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/** Ring pill with a colored pip ("해외", "자동 분류 · 정확도 낮음"). */
export function Pill({
  children,
  pip = "var(--place)",
  className,
}: {
  children: ReactNode;
  pip?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-surface px-[9px] text-xs font-semibold whitespace-nowrap text-ink shadow-[inset_0_0_0_1px_var(--line)]",
        className
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full" style={{ background: pip }} />
      {children}
    </span>
  );
}

/** Mono number with a smaller unit (`5,290km`). */
export function Fig({
  value,
  unit,
  className,
}: {
  value: ReactNode;
  unit?: string;
  className?: string;
}) {
  return (
    <span className={cn("num text-[22px] leading-7 font-medium text-ink", className)}>
      {value}
      {unit ? (
        <span className="ml-0.5 font-sans text-[15px] font-medium tracking-normal text-ink-3">
          {unit}
        </span>
      ) : null}
    </span>
  );
}

/** Staggered entrance: `ds-enter` with a 100ms step (reduced motion → fade). */
export function enter(step: number): { className: string; style: { animationDelay: string } } {
  return { className: "ds-enter", style: { animationDelay: `${step * 100}ms` } };
}

/**
 * Inline facts separated by "·" that never strand a separator: each item
 * carries its "·" before it, and the item that starts a line has that "·"
 * pushed into a negative margin the wrapper clips. Items move to the next line
 * whole (only one wider than the line wraps inside, at word gaps). So a wrap reads
 * "경유 14곳" / "11,251걸음의 날" with no dangling dot at either end.
 */
export function DotList({
  items,
  className,
}: {
  items: ReadonlyArray<{ key: string; node: ReactNode }>;
  className?: string;
}) {
  return (
    <span className={cn("block overflow-hidden", className)}>
      <span className="-ml-3 flex flex-wrap">
        {items.map((item) => (
          <span
            key={item.key}
            className="relative max-w-full pl-3 break-keep before:absolute before:left-[3px] before:content-['·']"
          >
            {item.node}
          </span>
        ))}
      </span>
    </span>
  );
}
