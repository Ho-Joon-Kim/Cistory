"use client";

import { useMemo } from "react";

export interface SwimlaneStream {
  id: string;
  label: string;
  tone: "green" | "amber" | "violet" | "orange" | "blue";
  /** Daily values for the year (length 365 or 366). */
  daily: number[];
}

interface SwimlaneProps {
  /** Each stream is one row. */
  streams: SwimlaneStream[];
  /** Year for month-tick alignment. */
  year: number;
  /** Total height of the SVG. */
  height?: number;
}

const TONE_HSL: Record<SwimlaneStream["tone"], string> = {
  green: "var(--accent-green)",
  amber: "var(--accent-amber)",
  violet: "var(--accent-violet)",
  orange: "var(--accent-orange)",
  blue: "var(--accent-blue)",
};

const MONTH_LABELS = [
  "1월",
  "2월",
  "3월",
  "4월",
  "5월",
  "6월",
  "7월",
  "8월",
  "9월",
  "10월",
  "11월",
  "12월",
];

/**
 * Year-long horizontal swimlane: one row per data stream, intensity = daily volume.
 * Each row is a row of vertical "lines" of varying opacity/glow.
 */
export function Swimlane({ streams, year, height = 200 }: SwimlaneProps) {
  const days = useMemo(() => {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeap ? 366 : 365;
  }, [year]);

  // Pre-compute month boundaries (day index of the 1st of each month)
  const monthBoundaries = useMemo(() => {
    const out: number[] = [];
    for (let m = 0; m < 12; m++) {
      const d = new Date(year, m, 1);
      const start = new Date(year, 0, 1);
      const diff = Math.floor((d.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      out.push(diff);
    }
    return out;
  }, [year]);

  const width = 720; // viewBox width — scales fluidly
  const headerH = 22;
  const labelW = 80;
  const trackW = width - labelW - 8;
  const rowH = (height - headerH) / streams.length;
  const dayW = trackW / days;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="block w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="기간별 활동 스윔레인"
    >
      {/* Month ticks */}
      {monthBoundaries.map((dayIdx, m) => {
        const x = labelW + dayIdx * dayW;
        return (
          <g key={`month-${dayIdx}`}>
            <line
              x1={x}
              x2={x}
              y1={headerH - 4}
              y2={height}
              className="stroke-[hsl(var(--hairline))]"
              strokeWidth={0.5}
            />
            <text
              x={x + 2}
              y={12}
              fontSize={9}
              className="fill-[hsl(var(--ink-mute))] tabular-mono"
            >
              {MONTH_LABELS[m]}
            </text>
          </g>
        );
      })}

      {/* Streams */}
      {streams.map((stream, si) => {
        const yTop = headerH + si * rowH;
        const yMid = yTop + rowH / 2;
        const max = Math.max(...stream.daily, 1);

        return (
          <g key={stream.id}>
            {/* Label */}
            <text
              x={labelW - 8}
              y={yMid + 3}
              fontSize={11}
              textAnchor="end"
              className="fill-[hsl(var(--ink-dim))]"
            >
              {stream.label}
            </text>

            {/* Baseline */}
            <line
              x1={labelW}
              x2={width - 4}
              y1={yMid}
              y2={yMid}
              strokeWidth={0.5}
              className="stroke-[hsl(var(--hairline))]"
            />

            {/* Daily ticks. `daily` is a dense positional series: index IS the
                day-of-year, so `di` is a tick's identity rather than a slot it
                happens to sit in. Fixed length (365/366) and never reordered,
                so the stale-state hazard noArrayIndexKey guards against cannot
                arise here — hence the suppression on the key below. */}
            {stream.daily.slice(0, days).map((v, di) => {
              if (v === 0) return null;
              const intensity = Math.min(v / max, 1);
              const tickH = (rowH - 4) * (0.3 + 0.7 * intensity);
              const x = labelW + di * dayW + dayW / 2;
              return (
                <line
                  // biome-ignore lint/suspicious/noArrayIndexKey: di is the day-of-year
                  key={`${stream.id}-${di}`}
                  x1={x}
                  x2={x}
                  y1={yMid - tickH / 2}
                  y2={yMid + tickH / 2}
                  strokeWidth={Math.max(dayW * 0.7, 1)}
                  stroke={`hsl(${TONE_HSL[stream.tone]} / ${0.25 + intensity * 0.75})`}
                  style={{
                    filter:
                      intensity > 0.7
                        ? `drop-shadow(0 0 2px hsl(${TONE_HSL[stream.tone]} / 0.6))`
                        : undefined,
                  }}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
