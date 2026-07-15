"use client";

import { type ReactNode, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Interactive overlay for the hand-built SVG charts: maps a pointer's x-position to
 * an evenly-spaced slot index, draws a crosshair at that slot, and floats a tooltip
 * with the selected point's label above it. Works for hover (desktop) and tap/drag
 * (touch) — the whole point is reading the value *at a chosen moment in time*.
 *
 * The chart itself is rendered via `render(active)` so it can emphasize the active
 * slot; positioning is done in percentages so it's independent of the SVG's own
 * viewBox units (charts use preserveAspectRatio="none").
 */
export function HoverLayer<T>({
  items,
  render,
  tooltip,
  crosshair = true,
  className,
}: {
  /** one entry per evenly-spaced slot, left → right */
  items: T[];
  /** the chart; receives the active slot index (or null) so it can highlight it */
  render: (active: number | null) => ReactNode;
  /** tooltip body for the active item */
  tooltip: (item: T, index: number) => ReactNode;
  crosshair?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const n = items.length;

  const pick = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || n === 0) return;
    const frac = (clientX - box.left) / box.width;
    setActive(Math.max(0, Math.min(n - 1, Math.floor(frac * n))));
  };

  const leftPct = active == null ? 0 : ((active + 0.5) / n) * 100;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer affordance over a chart; values are also exposed as SVG <title> for AT.
    <div
      ref={ref}
      className={cn("relative", className)}
      style={{ touchAction: "pan-y" }}
      onPointerMove={(e) => pick(e.clientX)}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerLeave={() => setActive(null)}
    >
      {render(active)}
      {active != null ? (
        <>
          {crosshair ? (
            <div
              className="pointer-events-none absolute inset-y-0 z-0 w-px -translate-x-1/2 bg-foreground/15"
              style={{ left: `${leftPct}%` }}
            />
          ) : null}
          <div
            className="pointer-events-none absolute bottom-full z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-hairline bg-popover px-2 py-1 text-[11px] leading-tight shadow-lg"
            style={{ left: `${Math.max(8, Math.min(92, leftPct))}%` }}
          >
            {tooltip(items[active], active)}
          </div>
        </>
      ) : null}
    </div>
  );
}
