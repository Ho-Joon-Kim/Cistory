"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Width of a container in CSS px, tracked with ResizeObserver. Charts draw in
 * real pixels (crisp 1px lines, round bar radii) instead of a stretched viewBox.
 * Returns 0 until the first measurement.
 */
export function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(Math.round(node.getBoundingClientRect().width));
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}
