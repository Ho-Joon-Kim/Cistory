"use client";

interface DonutSegment {
  label: string;
  value: number;
  tone: "green" | "amber" | "orange" | "violet" | "blue" | "red";
}

interface DonutProps {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  /** Center label (top — typically a number). */
  centerValue?: React.ReactNode;
  /** Center label (bottom — typically a unit). */
  centerLabel?: React.ReactNode;
}

const TONE_HSL: Record<DonutSegment["tone"], string> = {
  green: "var(--accent-green)",
  amber: "var(--accent-amber)",
  orange: "var(--accent-orange)",
  violet: "var(--accent-violet)",
  blue: "var(--accent-blue)",
  red: "var(--accent-red)",
};

/**
 * Stroke-dasharray donut. Used by NetSpendCard, RepoSplitCard, TripsCard.
 */
export function Donut({
  segments,
  size = 160,
  thickness = 18,
  centerValue,
  centerLabel,
}: DonutProps) {
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;

  let offset = 0;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="block" role="img" aria-label="도넛 차트">
        {/* Track */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          strokeWidth={thickness}
          className="stroke-[hsl(var(--hairline))]"
        />
        {/* Segments */}
        {segments.map((seg) => {
          const len = (seg.value / total) * circ;
          const dashArray = `${len} ${circ - len}`;
          const rotate = (offset / circ) * 360 - 90;
          offset += len;
          return (
            <circle
              key={seg.label}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              strokeWidth={thickness}
              stroke={`hsl(${TONE_HSL[seg.tone]} / 0.85)`}
              strokeDasharray={dashArray}
              strokeDashoffset={0}
              transform={`rotate(${rotate} ${cx} ${cy})`}
              strokeLinecap="butt"
              style={{ filter: `drop-shadow(0 0 4px hsl(${TONE_HSL[seg.tone]} / 0.4))` }}
            />
          );
        })}
      </svg>
      {(centerValue || centerLabel) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {centerValue ? (
            <div className="tabular-mono text-2xl font-semibold leading-none text-foreground">
              {centerValue}
            </div>
          ) : null}
          {centerLabel ? (
            <div className="mt-1 text-[10px] uppercase tracking-[0.08em] text-ink-mute">
              {centerLabel}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
