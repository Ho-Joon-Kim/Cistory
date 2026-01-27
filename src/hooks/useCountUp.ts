"use client";

import { useState, useEffect, useRef } from "react";

interface UseCountUpOptions {
  duration?: number;
  delay?: number;
  easing?: (t: number) => number;
}

// Easing functions
const easings = {
  easeOutQuad: (t: number) => t * (2 - t),
  easeOutCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  easeOutExpo: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
};

export function useCountUp(
  end: number,
  options: UseCountUpOptions = {}
): number {
  const { duration = 500, delay = 0, easing = easings.easeOutCubic } = options;
  const [count, setCount] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const prevEndRef = useRef(end);

  useEffect(() => {
    // Skip animation if end is 0 or hasn't changed
    if (end === 0) {
      setCount(0);
      return;
    }

    const startValue = prevEndRef.current !== end ? count : 0;
    prevEndRef.current = end;

    const animate = (timestamp: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = timestamp + delay;
      }

      const elapsed = timestamp - startTimeRef.current;

      if (elapsed < 0) {
        rafRef.current = requestAnimationFrame(animate);
        return;
      }

      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easing(progress);
      const currentValue = Math.round(
        startValue + (end - startValue) * easedProgress
      );

      setCount(currentValue);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    startTimeRef.current = null;
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [end, duration, delay, easing, count]);

  return count;
}

// Hook for animating from previous value to new value
export function useAnimatedNumber(
  value: number,
  options: UseCountUpOptions = {}
): number {
  const { duration = 400 } = options;
  const [displayValue, setDisplayValue] = useState(value);
  const [targetValue, setTargetValue] = useState(value);
  const startValueRef = useRef(value);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (value === targetValue) return;

    startValueRef.current = displayValue;
    setTargetValue(value);
    startTimeRef.current = null;

    const animate = (timestamp: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = timestamp;
      }

      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easings.easeOutCubic(progress);
      const current = Math.round(
        startValueRef.current + (value - startValueRef.current) * eased
      );

      setDisplayValue(current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [value, targetValue, displayValue, duration]);

  return displayValue;
}
