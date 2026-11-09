"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ReactNode } from "react";
import type { FactRow } from "@/lib/facts/types";
import { cn } from "@/lib/utils";

/**
 * The evidence list: "이 문장에 쓴 사실" + metric/period → value rows + optional
 * note. Rendered by FactTrigger; exported for static use.
 */
export function FactPopover({
  rows,
  title = "이 문장에 쓴 사실",
  note,
  className,
}: {
  rows: FactRow[];
  title?: string;
  note?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-80 max-w-[calc(100vw-32px)] rounded-xl bg-surface px-4 py-3.5 font-sans text-xs leading-[18px] font-normal tracking-normal text-ink shadow-pop",
        className
      )}
    >
      <span className="mb-2 block font-medium text-ink-3">{title}</span>
      <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5">
        {rows.map((row) => (
          <div key={`${row.label}|${row.value}`} className="contents">
            <dt className="text-ink-2">{row.label}</dt>
            <dd className="num m-0 text-right text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
      {note ? <span className="mt-2.5 block text-ink-3">{note}</span> : null}
    </div>
  );
}

/**
 * The one dotted-underlined fact inside an AI sentence. Click/tap (or Enter)
 * opens the evidence popover under it; outside click, Escape or a second click
 * closes it. Carries `aria-expanded` and `aria-label="근거 보기: <fact>"`.
 */
export function FactTrigger({
  children,
  rows,
  title,
  note,
  numeric = true,
  align = "start",
  side = "bottom",
  label,
  className,
}: {
  children: ReactNode;
  rows: FactRow[];
  title?: string;
  note?: ReactNode;
  /** Render the trigger in Geist Mono (default true — most facts are numbers). */
  numeric?: boolean;
  align?: "start" | "center" | "end";
  side?: "bottom" | "top";
  /** Text for the aria-label when children aren't plain text. */
  label?: string;
  className?: string;
}) {
  const text = label ?? (typeof children === "string" ? children : undefined);
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger
        type="button"
        aria-label={text ? `근거 보기: ${text}` : "근거 보기"}
        className={cn("ds-fact", numeric && "num", className)}
      >
        {children}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={16}
          aria-label="근거"
          className="ds-pop z-50 origin-(--radix-popover-content-transform-origin) outline-none"
        >
          <FactPopover rows={rows} title={title} note={note} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
