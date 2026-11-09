"use client";

import type { ReactNode } from "react";
import { useAnimatedNumber } from "@/lib/hooks/useCountUp";
import { cn } from "@/lib/utils";

/**
 * Counts from `from` (default 0) up to `value` on mount and to every new value
 * after; jumps straight there under prefers-reduced-motion. `format` turns the
 * animated number into text (default: grouped integer / `decimals`).
 */
export function CountUp({
  value,
  format,
  decimals = 0,
  duration = 600,
  from = 0,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  decimals?: number;
  duration?: number;
  from?: number;
  className?: string;
}) {
  const shown = useAnimatedNumber(value, { duration, from, decimals });
  const text = format
    ? format(shown)
    : shown.toLocaleString("ko-KR", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
  return <span className={cn("num", className)}>{text}</span>;
}

interface NumberProps {
  /** Formatted text, or a number (rendered with CountUp when `countUp`). */
  value: ReactNode | number;
  /** Unit after the number: 건, 원, 만원, km … (smaller, --ink3). */
  unit?: string;
  countUp?: boolean;
  /** Formatter for the count-up frames when `value` is a number. */
  format?: (n: number) => string;
  decimals?: number;
  className?: string;
}

function renderValue({ value, countUp, format, decimals }: NumberProps) {
  if (typeof value === "number") {
    return countUp ? (
      <CountUp value={value} format={format} decimals={decimals} />
    ) : format ? (
      format(value)
    ) : (
      value.toLocaleString("ko-KR")
    );
  }
  return value;
}

/**
 * The page's one hero figure: Geist Mono 500, 36/40 on phones, 48/52 from sm;
 * unit at 0.45em in --ink3. Lead it with a comparison line, not alone.
 */
export function HeroNumber(props: NumberProps) {
  return (
    <span
      className={cn(
        "num text-[36px] leading-10 font-medium text-ink sm:text-[48px] sm:leading-[52px]",
        props.className
      )}
    >
      {renderValue(props)}
      {props.unit ? <span className="ml-1 text-[0.45em] text-ink-3">{props.unit}</span> : null}
    </span>
  );
}

/** Secondary figures: Geist Mono 500 22/28, unit at 0.6em in --ink3. */
export function SecondaryNumber(props: NumberProps) {
  return (
    <span className={cn("num text-[22px] leading-7 font-medium text-ink", props.className)}>
      {renderValue(props)}
      {props.unit ? <span className="ml-0.5 text-[0.6em] text-ink-3">{props.unit}</span> : null}
    </span>
  );
}
