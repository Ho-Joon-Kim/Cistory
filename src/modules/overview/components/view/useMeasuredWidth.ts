"use client";

import { useCallback, useState } from "react";

/**
 * Width of a container in CSS px, tracked with ResizeObserver. Charts draw in
 * real pixels (crisp 1px lines, round bar radii) instead of a stretched viewBox.
 * Returns 0 until the first measurement.
 *
 * A callback ref, so an element that mounts after the first render (a chart
 * that renders nothing until its history arrives) is still measured.
 */
export function useMeasuredWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  const ref = useCallback((node: T | null) => {
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
