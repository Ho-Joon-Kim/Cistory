"use client";

import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { signToneClass } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Market-domain tone class: red gain, blue loss, ink at zero. */
export const marketTone = (n: number) => signToneClass(n, "market");

/** Up/down stroke arrow that leads a change figure. */
export function ChangeArrow({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d={value >= 0 ? "M12 19V5M5 12l7-7 7 7" : "M12 5v14M19 12l-7 7-7-7"} />
    </svg>
  );
}

export function Chevron({
  open,
  direction = "down",
  size = 16,
  className,
}: {
  open: boolean;
  direction?: "down" | "right";
  size?: number;
  className?: string;
}) {
  const rotate = direction === "down" ? (open ? 180 : 0) : open ? 90 : 0;
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--ink3)"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "shrink-0 transition-[rotate] duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
        className
      )}
      style={{ rotate: `${rotate}deg` }}
    >
      <path d={direction === "down" ? "M6 9l6 6 6-6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

/** Section heading: serif 20/28 on phones, 22/30 from lg. */
export function SectionTitle({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <h2 className="m-0 font-serif text-xl leading-7 font-semibold tracking-[-0.02em] text-ink lg:text-[22px] lg:leading-[30px]">
        {children}
      </h2>
      {meta ? <span className="text-[13px] text-ink-2 lg:text-sm">{meta}</span> : null}
    </div>
  );
}

/** Staged entrance: `ds-enter` with a 100ms step per index (reduced motion → fade). */
export function enterStyle(step: number): CSSProperties {
  return { animationDelay: `${step * 100}ms`, animationFillMode: "backwards" };
}

/**
 * Width of an element, tracked with a ResizeObserver (0 until measured). Returns
 * a callback ref so an element mounted later (after data arrives) is observed too.
 */
export function useElementWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const update = () => setWidth(Math.round(el.getBoundingClientRect().width));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

/** Whether the viewport is at least the PC breakpoint (1024px). */
export function useIsDesktop() {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return desktop;
}

/**
 * A full-width disclosure row (title · one-line summary · chevron) that reveals
 * its panel underneath. PC lays title and summary on one line; phones stack them.
 */
export function Disclosure({
  id,
  title,
  summary,
  mobileSummary,
  open,
  onToggle,
  last,
  children,
}: {
  id: string;
  title: ReactNode;
  summary: ReactNode;
  mobileSummary?: ReactNode;
  open: boolean;
  onToggle: () => void;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("border-t border-line", last && "border-b")}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="group grid min-h-11 w-full cursor-pointer grid-cols-[minmax(0,1fr)_20px] items-center border-0 bg-transparent py-3.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand lg:grid-cols-[200px_minmax(0,1fr)_24px] lg:py-[18px]"
      >
        <span className="flex flex-col gap-0.5 lg:contents">
          <span className="text-[15px] leading-[22px] font-semibold text-ink transition-colors duration-150 group-hover:text-ink">
            {title}
          </span>
          <span className="text-xs text-ink-3 lg:hidden">{mobileSummary ?? summary}</span>
          <span className="hidden text-sm text-ink-2 lg:block">{summary}</span>
        </span>
        <Chevron open={open} />
      </button>
      {open ? (
        <div id={id} className="ds-reveal pb-5 lg:pb-6">
          {children}
        </div>
      ) : null}
    </div>
  );
}
