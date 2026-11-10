"use client";

import { useEffect, useState } from "react";
import { prefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";

const ease = (t: number) => 1 - (1 - t) ** 3;

/**
 * Elapsed ms since mount, ticking for `total` ms, for staggering SVG bar growth
 * in JS (CSS `scale` on SVG rects is unreliable in some compositing paths).
 * Under reduced motion it starts finished.
 */
export function useGrowClock(total: number) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setElapsed(total);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = () => {
      const e = performance.now() - start;
      setElapsed(Math.min(total, e));
      if (e < total) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [total]);
  /** Eased 0..1 growth of an item that starts `delay` ms in and lasts `duration` ms. */
  return (delay: number, duration = 600) =>
    elapsed >= total ? 1 : ease(Math.min(1, Math.max(0, (elapsed - delay) / duration)));
}
