"use client";

import { useMemo } from "react";

interface RadialClockProps {
  /** 24 entries — one per hour-of-day. Each is { ai, human } seconds OR additions. */
  hours: { ai: number; human: number }[];
  /** Outer SVG size in px (square). */
  size?: number;
}

/**
 * 24-hour radial clock.
 * - Each hour is a wedge (15° each).
 * - Inner radius = AI portion, outer radius = AI+human (total).
 * - Wedge radial length encodes total volume; AI vs human is the inner ring.
 *
 * Used by AIClockCard.
 */
export function RadialClock({ hours, size = 280 }: RadialClockProps) {
  const cx = size / 2;
  const cy = size / 2;
  const rMax = size * 0.42;
  const rMin = size * 0.14;

  const max = useMemo(() => {
    return Math.max(...hours.map((h) => h.ai + h.human), 1);
  }, [hours]);

  // Build per-hour wedge paths
  const wedges = hours.map((bucket, h) => {
    const total = bucket.ai + bucket.human;
    const aiRatio = total > 0 ? bucket.ai / total : 0;
    const radial = (total / max) * (rMax - rMin);
    const rOuter = rMin + radial;
    const rInner = rMin + radial * aiRatio;

    // Hour h occupies degrees [h*15, (h+1)*15], rotated so 0° = top (12am at top)
    const startAng = ((h * 15 - 90) * Math.PI) / 180;
    const endAng = (((h + 1) * 15 - 90) * Math.PI) / 180;

    const x1o = cx + Math.cos(startAng) * rOuter;
    const y1o = cy + Math.sin(startAng) * rOuter;
    const x2o = cx + Math.cos(endAng) * rOuter;
    const y2o = cy + Math.sin(endAng) * rOuter;
    const x1i = cx + Math.cos(startAng) * rMin;
    const y1i = cy + Math.sin(startAng) * rMin;
    const x2i = cx + Math.cos(endAng) * rMin;
    const y2i = cy + Math.sin(endAng) * rMin;

    const fullPath = [
      `M ${x1i} ${y1i}`,
      `L ${x1o} ${y1o}`,
      `A ${rOuter} ${rOuter} 0 0 1 ${x2o} ${y2o}`,
      `L ${x2i} ${y2i}`,
      `A ${rMin} ${rMin} 0 0 0 ${x1i} ${y1i}`,
      "Z",
    ].join(" ");

    // AI inner wedge (overlay)
    const x1ai = cx + Math.cos(startAng) * rInner;
    const y1ai = cy + Math.sin(startAng) * rInner;
    const x2ai = cx + Math.cos(endAng) * rInner;
    const y2ai = cy + Math.sin(endAng) * rInner;

    const aiPath =
      aiRatio > 0
        ? [
            `M ${x1i} ${y1i}`,
            `L ${x1ai} ${y1ai}`,
            `A ${rInner} ${rInner} 0 0 1 ${x2ai} ${y2ai}`,
            `L ${x2i} ${y2i}`,
            `A ${rMin} ${rMin} 0 0 0 ${x1i} ${y1i}`,
            "Z",
          ].join(" ")
        : null;

    return { hour: h, fullPath, aiPath, total };
  });

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="block w-full" aria-hidden>
      {/* Hour ticks (every 6) */}
      {[0, 6, 12, 18].map((tick) => {
        const ang = ((tick * 15 - 90) * Math.PI) / 180;
        const x = cx + Math.cos(ang) * (rMax + 12);
        const y = cy + Math.sin(ang) * (rMax + 12);
        const label = tick === 0 ? "00" : tick === 12 ? "12" : tick === 6 ? "06" : "18";
        return (
          <text
            key={`tick-${tick}`}
            x={x}
            y={y + 3}
            fontSize={10}
            textAnchor="middle"
            className="fill-[hsl(var(--ink-mute))] tabular-mono"
          >
            {label}
          </text>
        );
      })}

      {/* Inner ring */}
      <circle
        cx={cx}
        cy={cy}
        r={rMin}
        className="fill-none stroke-[hsl(var(--hairline))]"
        strokeWidth={1}
      />

      {/* Wedges: total (amber) under, AI (green) over */}
      {wedges.map((w) =>
        w.total > 0 ? (
          <path
            key={`total-${w.hour}`}
            d={w.fullPath}
            className="fill-[hsl(var(--accent-amber)/0.55)]"
          />
        ) : null
      )}
      {wedges.map((w) =>
        w.aiPath ? (
          <path
            key={`ai-${w.hour}`}
            d={w.aiPath}
            className="fill-[hsl(var(--accent-green))]"
            style={{ filter: "drop-shadow(0 0 3px hsl(var(--accent-green) / 0.6))" }}
          />
        ) : null
      )}
    </svg>
  );
}
