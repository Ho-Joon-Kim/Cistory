"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface HistogramProps {
  /** Raw values (e.g. commute durations in minutes). */
  values: number[];
  /** Number of bins. Default: 16. */
  bins?: number;
  /** Min/max bin edges (inclusive); auto-derived from data if omitted. */
  min?: number;
  max?: number;
  /** Hue for bar fill. */
  tone?: "green" | "amber" | "orange" | "violet" | "blue";
  /** Highlight the IQR (p25–p75) band? */
  highlightIqr?: boolean;
  /** Reference lines: vertical markers at given x-values, with optional label/style. */
  refs?: {
    value: number;
    label?: string;
    dashed?: boolean;
    tone?: "green" | "amber" | "violet" | "blue";
  }[];
  /** Width × Height in px. Defaults to fluid 100% × 120. */
  width?: number;
  height?: number;
  /** Override x-axis label formatter. */
  formatX?: (v: number) => string;
}

const TONE_FILL: Record<NonNullable<HistogramProps["tone"]>, string> = {
  green: "fill-[hsl(var(--accent-green)/0.5)]",
  amber: "fill-[hsl(var(--accent-amber)/0.5)]",
  orange: "fill-[hsl(var(--accent-orange)/0.5)]",
  violet: "fill-[hsl(var(--accent-violet)/0.5)]",
  blue: "fill-[hsl(var(--accent-blue)/0.5)]",
};

const TONE_IQR: Record<NonNullable<HistogramProps["tone"]>, string> = {
  green: "fill-[hsl(var(--accent-green)/0.85)]",
  amber: "fill-[hsl(var(--accent-amber)/0.85)]",
  orange: "fill-[hsl(var(--accent-orange)/0.85)]",
  violet: "fill-[hsl(var(--accent-violet)/0.85)]",
  blue: "fill-[hsl(var(--accent-blue)/0.85)]",
};

/**
 * Quartile-aware histogram. Renders bars + optional IQR band + ref lines.
 * Used by CommuteReliabilityCard and any quartile/distribution view.
 */
export function Histogram({
  values,
  bins = 16,
  min,
  max,
  tone = "amber",
  highlightIqr = true,
  refs = [],
  width = 480,
  height = 120,
  formatX,
}: HistogramProps) {
  const { binCounts, binEdges, p25, p75 } = useMemo(() => {
    if (values.length === 0) {
      return { binCounts: [], binEdges: [], p25: 0, p75: 0 };
    }
    const sorted = [...values].sort((a, b) => a - b);
    const lo = min ?? sorted[0];
    const hi = max ?? sorted[sorted.length - 1];
    const span = Math.max(hi - lo, 1);
    const step = span / bins;

    const counts = new Array(bins).fill(0);
    const edges = Array.from({ length: bins + 1 }, (_, i) => lo + step * i);

    for (const v of values) {
      let idx = Math.floor((v - lo) / step);
      if (idx < 0) idx = 0;
      if (idx >= bins) idx = bins - 1;
      counts[idx]++;
    }

    const p = (q: number) =>
      sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)))];
    return { binCounts: counts, binEdges: edges, p25: p(0.25), p75: p(0.75) };
  }, [values, bins, min, max]);

  if (binCounts.length === 0) {
    return (
      <div className="flex h-[120px] items-center justify-center text-xs text-ink-mute">
        데이터 없음
      </div>
    );
  }

  const maxCount = Math.max(...binCounts, 1);
  const barW = width / bins;
  const lo = binEdges[0];
  const hi = binEdges[binEdges.length - 1];
  const span = hi - lo || 1;
  const xOf = (v: number) => ((v - lo) / span) * width;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="block w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="히스토그램"
    >
      {/* Bars */}
      {binCounts.map((c, i) => {
        const h = (c / maxCount) * (height - 24);
        const y = height - 16 - h;
        const x = i * barW + 1;
        const w = Math.max(barW - 2, 1);
        const center = binEdges[i] + (binEdges[i + 1] - binEdges[i]) / 2;
        const inIqr = center >= p25 && center <= p75;
        return (
          <rect
            key={`bin-${binEdges[i]}`}
            x={x}
            y={y}
            width={w}
            height={Math.max(h, 1)}
            rx={1}
            className={cn(
              highlightIqr && inIqr ? TONE_IQR[tone] : TONE_FILL[tone],
              highlightIqr && inIqr && "drop-shadow-[0_0_4px_hsl(var(--accent-amber)/0.4)]"
            )}
          />
        );
      })}

      {/* Baseline */}
      <line
        x1={0}
        x2={width}
        y1={height - 16}
        y2={height - 16}
        className="stroke-[hsl(var(--hairline))]"
        strokeWidth={1}
      />

      {/* Reference lines */}
      {refs.map((r) => {
        const x = xOf(r.value);
        const strokeClass =
          r.tone === "green"
            ? "stroke-[hsl(var(--accent-green))]"
            : r.tone === "violet"
              ? "stroke-[hsl(var(--accent-violet))]"
              : r.tone === "blue"
                ? "stroke-[hsl(var(--accent-blue))]"
                : "stroke-[hsl(var(--ink-dim))]";
        return (
          <g key={`ref-${r.label ?? r.value}`}>
            <line
              x1={x}
              x2={x}
              y1={4}
              y2={height - 16}
              strokeWidth={1.5}
              strokeDasharray={r.dashed ? "3 3" : undefined}
              className={strokeClass}
            />
            {r.label ? (
              <text
                x={x + 3}
                y={11}
                className="fill-[hsl(var(--ink-dim))] tabular-mono"
                fontSize={9}
              >
                {r.label}
              </text>
            ) : null}
          </g>
        );
      })}

      {/* X-axis labels: lo / mid / hi */}
      <text x={2} y={height - 4} fontSize={9} className="fill-[hsl(var(--ink-mute))] tabular-mono">
        {formatX ? formatX(lo) : lo.toFixed(0)}
      </text>
      <text
        x={width / 2}
        y={height - 4}
        fontSize={9}
        textAnchor="middle"
        className="fill-[hsl(var(--ink-mute))] tabular-mono"
      >
        {formatX ? formatX((lo + hi) / 2) : ((lo + hi) / 2).toFixed(0)}
      </text>
      <text
        x={width - 2}
        y={height - 4}
        fontSize={9}
        textAnchor="end"
        className="fill-[hsl(var(--ink-mute))] tabular-mono"
      >
        {formatX ? formatX(hi) : hi.toFixed(0)}
      </text>
    </svg>
  );
}
