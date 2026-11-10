"use client";

import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Serif section heading: 20/28 on phones, 22/30 from sm. */
export function SectionTitle({
  children,
  className,
  as: Tag = "h2",
}: {
  children: ReactNode;
  className?: string;
  as?: "h2" | "h3";
}) {
  return (
    <Tag
      className={cn(
        "m-0 font-serif text-xl leading-7 font-semibold tracking-[-0.02em] text-ink sm:text-[22px] sm:leading-[30px]",
        className
      )}
    >
      {children}
    </Tag>
  );
}

/** Block heading inside a section: 15/22 600. */
export function BlockTitle({
  children,
  className,
  as: Tag = "h3",
}: {
  children: ReactNode;
  className?: string;
  as?: "h2" | "h3";
}) {
  return (
    <Tag className={cn("m-0 text-[15px] leading-[22px] font-semibold text-ink", className)}>
      {children}
    </Tag>
  );
}

export function Chevron({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** "월말 예상 ⌄" — a text disclosure whose chevron turns when open. */
export function DisclosureButton({
  open,
  onToggle,
  controls,
  children,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  controls?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className={cn(
        "-ml-2 inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent pr-2.5 pl-2 text-sm font-semibold text-ink transition-[background-color,scale] duration-150 ease-out active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-brand sm:h-8 [@media(hover:hover)]:hover:bg-track",
        className
      )}
    >
      {children}
      <Chevron
        className={cn(
          "transition-[rotate] duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
          open && "rotate-180"
        )}
      />
    </button>
  );
}

type Variant = "secondary" | "ghost" | "danger" | "primary";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-brand text-brand-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(0_0_0/0.14)]",
  secondary: "bg-surface text-ink shadow-ring [@media(hover:hover)]:hover:shadow-ring-hover",
  ghost: "bg-transparent text-ink-2 [@media(hover:hover)]:hover:bg-track",
  danger:
    "bg-transparent text-danger shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--danger)_38%,transparent)] [@media(hover:hover)]:hover:bg-danger-soft",
};

/** Mockup `.btn`: 36 tall (44 on touch), 13px 600, scale on press. */
export function ActionButton({
  variant = "secondary",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-[9px] border-0 px-3.5 text-[13px] font-semibold whitespace-nowrap transition-[scale,box-shadow,background-color] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 [&:not(:disabled)]:active:scale-[0.96]",
        VARIANTS[variant],
        className
      )}
    >
      {children}
    </button>
  );
}

/** Thin progress track (ink fill) for the bulk notification actions. */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className="h-1.5 overflow-hidden rounded-full bg-track"
    >
      <div
        className="h-full rounded-full bg-ink transition-[width] duration-300 ease-out"
        style={{ width: `${pct}%` } as CSSProperties}
      />
    </div>
  );
}

/** Staged entrance: `ds-enter` with a 100ms step (reduced motion → fade only). */
export function enter(step: number): { className: string; style: CSSProperties } {
  return { className: "ds-enter", style: { animationDelay: `${step * 100}ms` } };
}
