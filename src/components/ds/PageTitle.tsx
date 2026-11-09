import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Page container: the shared gutter (16 · 24 · 96, see `px-page`), 24px (phone) /
 * 40px (PC) below the app bar, max width 1440.
 */
export function PageContainer({
  children,
  className,
  as: Tag = "main",
  id = "main",
}: {
  children: ReactNode;
  className?: string;
  as?: "main" | "div";
  id?: string;
}) {
  return (
    <Tag
      id={id}
      className={cn("mx-auto w-full max-w-[1440px] px-page pt-6 pb-16 lg:pt-10", className)}
    >
      {children}
    </Tag>
  );
}

/**
 * Serif page title, 26/34 on phones and 32/40 from sm, with an optional one-line
 * meta under it (14px --ink2) and optional actions on the right (wrap below on
 * phones). No eyebrows, no uppercase Latin labels.
 */
export function PageTitle({
  title,
  meta,
  actions,
  className,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="m-0 font-serif text-[26px] leading-[34px] font-bold tracking-[-0.02em] text-ink sm:text-[32px] sm:leading-10">
          {title}
        </h1>
        {meta ? <div className="text-sm leading-[22px] text-ink-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex w-full items-center gap-2 sm:w-auto">{actions}</div> : null}
    </div>
  );
}

/** "a · b · c" meta line in --ink2; falsy items are skipped. */
export function MetaLine({
  items,
  className,
  size = "md",
}: {
  items: ReactNode[];
  className?: string;
  /** md = 14/22 (page meta), sm = 12/16 (row meta, --ink3). */
  size?: "md" | "sm";
}) {
  const shown = items.filter(
    (item) => item !== null && item !== undefined && item !== false && item !== ""
  );
  if (shown.length === 0) return null;
  return (
    <p
      className={cn(
        "m-0",
        size === "md" ? "text-sm leading-[22px] text-ink-2" : "text-xs leading-4 text-ink-3",
        className
      )}
    >
      {shown.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional, static per render
        <span key={i}>
          {i > 0 ? <span aria-hidden="true"> · </span> : null}
          {item}
        </span>
      ))}
    </p>
  );
}
