"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A small ring pill on an unusual row ("큰 결제", "첫 방문"). It toggles the row's
 * reason line (`RowFlagReason`, usually an AiLine) rendered by the host under
 * the row — controlled, so the host owns which row is open.
 */
export function RowFlag({
  label,
  open,
  onOpenChange,
  controls,
  className,
}: {
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** id of the reason element, for aria-controls. */
  controls?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={(event) => {
        event.stopPropagation();
        onOpenChange(!open);
      }}
      className={cn(
        "inline-flex h-5 cursor-pointer items-center gap-[5px] rounded-full border-0 bg-surface px-[7px] font-sans text-xs font-medium whitespace-nowrap text-ink-2 shadow-[inset_0_0_0_1px_var(--line)] transition-shadow duration-150 ease-out hover:shadow-[inset_0_0_0_1px_var(--ink3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        className
      )}
    >
      {label}
    </button>
  );
}

/** The revealed reason under a flagged row (6px gap, 200ms reveal). */
export function RowFlagReason({
  open,
  id,
  children,
  className,
}: {
  open: boolean;
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  if (!open) return null;
  return (
    <div id={id} className={cn("ds-reveal mt-1.5", className)}>
      {children}
    </div>
  );
}
