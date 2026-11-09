"use client";

import type { CSSProperties } from "react";
import type { FactEvidence, FactRow } from "@/lib/facts/types";
import { cn } from "@/lib/utils";
import { useEvidenceTrigger } from "./evidence";
import { FactTrigger } from "./FactTrigger";

/**
 * An annotation pinned to a chart point: a 1px --ink3 leader line and a serif
 * 12px label that is itself the fact trigger. Place it inside a
 * `position: relative` chart box; `x` is the point's horizontal position, `top`
 * where the label sits and `leader` the line length below the label.
 * Use 1–3 per chart, chosen from computed candidates (peak, anomaly, window).
 */
export function ChartAnnotation({
  x,
  top,
  leader,
  label,
  rows,
  evidence,
  side = "right",
  numeric = false,
  className,
}: {
  x: number | string;
  top: number | string;
  leader: number | string;
  label: string;
  rows: FactRow[];
  evidence?: FactEvidence | null;
  /** Label to the right (default) or left of the leader line. */
  side?: "right" | "left";
  numeric?: boolean;
  className?: string;
}) {
  const handlers = useEvidenceTrigger(evidence);
  const px = (v: number | string) => (typeof v === "number" ? `${v}px` : v);
  return (
    <span
      className={cn("pointer-events-none absolute", className)}
      style={{ left: px(x), top: px(top) } as CSSProperties}
    >
      <span
        aria-hidden="true"
        className="absolute left-0 top-4 border-l border-ink-3"
        style={{ height: px(leader) }}
      />
      <span
        className={cn(
          "pointer-events-auto absolute top-0 font-serif text-xs leading-4 font-medium tracking-[-0.01em] whitespace-nowrap text-ink",
          side === "right" ? "left-[5px]" : "right-[5px]"
        )}
        {...handlers}
      >
        <FactTrigger rows={rows} numeric={numeric} align={side === "right" ? "start" : "end"}>
          {label}
        </FactTrigger>
      </span>
    </span>
  );
}
