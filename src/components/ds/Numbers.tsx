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
  /** "small" (default): the unit is set smaller in --ink3 after a gap.
   * "full": the unit runs on at the number's own size and color ("2,083,890원"). */
  unitSize?: "small" | "full";
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

function Unit({
  unit,
  size = "small",
  className,
}: {
  unit?: string;
  size?: "small" | "full";
  className: string;
}) {
  if (!unit) return null;
  return size === "full" ? <span>{unit}</span> : <span className={className}>{unit}</span>;
}

/**
 * The page's one hero figure: Geist Mono 500, 36/40 on phones, 48/52 from sm;
 * unit at 0.45em in --ink3 (or full size with `unitSize="full"`). Lead it with a
 * comparison line, not alone.
 */
export function HeroNumber(props: NumberProps) {
  return (
    <span
      className={cn(
        "num text-[2.25rem] leading-10 font-medium text-ink sm:text-[3rem] sm:leading-[3.25rem]",
        props.className
      )}
    >
      {renderValue(props)}
      <Unit unit={props.unit} size={props.unitSize} className="ml-1 text-[0.45em] text-ink-3" />
    </span>
  );
}

/** Secondary figures: Geist Mono 500 22/28, unit at 0.6em in --ink3. */
export function SecondaryNumber(props: NumberProps) {
  return (
    <span className={cn("num text-[1.375rem] leading-7 font-medium text-ink", props.className)}>
      {renderValue(props)}
      <Unit unit={props.unit} size={props.unitSize} className="ml-0.5 text-[0.6em] text-ink-3" />
    </span>
  );
}
