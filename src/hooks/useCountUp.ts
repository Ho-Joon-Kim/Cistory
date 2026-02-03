"use client";

import { useState, useEffect, useRef } from "react";

interface UseCountUpOptions {
  duration?: number;
  delay?: number;
  easing?: (t: number) => number;
}

// Easing functions
const easings = {
  easeOutCubic: (t: number) => 1 - Math.pow(1 - t, 3),
};

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
