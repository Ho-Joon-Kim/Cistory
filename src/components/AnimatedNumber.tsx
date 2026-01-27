"use client";

import { useAnimatedNumber } from "@/hooks/useCountUp";

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
}

export function AnimatedNumber({
  value,
  duration = 400,
  className = "",
  prefix = "",
  suffix = "",
}: AnimatedNumberProps) {
  const displayValue = useAnimatedNumber(value, { duration });

  return (
    <span className={`tabular-nums ${className}`}>
      {prefix}
      {displayValue.toLocaleString()}
      {suffix}
    </span>
  );
}
