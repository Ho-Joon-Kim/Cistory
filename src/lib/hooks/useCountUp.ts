"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./usePrefersReducedMotion";

interface UseCountUpOptions {
  duration?: number;
  /** Value shown on the first render (e.g. 0 to count up on mount). Default: `value`. */
  from?: number;
  /** Fraction digits kept while animating (541.7만원 → 1). Default 0. */
  decimals?: number;
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/** Interpolated value at `elapsed` ms of a `from` → `to` count of `duration` ms. */
export function countUpFrame(
  from: number,
  to: number,
  elapsed: number,
  duration: number,
  decimals = 0
): number {
  if (duration <= 0) return to;
  const progress = Math.min(Math.max(elapsed / duration, 0), 1);
  if (progress === 1) return to;
  const scale = 10 ** decimals;
  return Math.round((from + (to - from) * easeOutCubic(progress)) * scale) / scale;
}

/**
 * Animates from the currently displayed number to `value`. A change mid-animation
 * retargets from wherever the display is. Jumps straight to `value` when the user
 * prefers reduced motion.
 */
export function useAnimatedNumber(value: number, options: UseCountUpOptions = {}): number {
  const { duration = 400, from: initial, decimals = 0 } = options;
  const [displayValue, setDisplayValue] = useState(initial ?? value);
  const displayRef = useRef(initial ?? value);

  useEffect(() => {
    const from = displayRef.current;
    if (from === value) return;

    const show = (next: number) => {
      displayRef.current = next;
      setDisplayValue(next);
    };

    if (duration <= 0 || prefersReducedMotion()) {
      show(value);
      return;
    }

    let start: number | null = null;
    let raf = 0;
    const animate = (timestamp: number) => {
      if (start === null) start = timestamp;
      const elapsed = timestamp - start;
      show(countUpFrame(from, value, elapsed, duration, decimals));
      if (elapsed < duration) raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(raf);
  }, [value, duration, decimals]);

  return displayValue;
}
