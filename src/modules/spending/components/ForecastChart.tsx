"use client";

import type { CumulativeDataPoint } from "../types";
import { niceTicks, tickLabel } from "../view-model";
import { useElementWidth } from "./useElementWidth";

const H = 160;

/**
 * Month-to-date cumulative spending (solid) and the month-end forecast: a
 * dashed line to the predicted total and two faint lines to the range bounds.
 */
export function ForecastChart({
  curve,
  today,
  daysInMonth,
  predicted,
  upper,
  lower,
  monthLabel,
}: {
  curve: CumulativeDataPoint[];
  today: number;
  daysInMonth: number;
  predicted: number;
  upper: number;
  lower: number;
  monthLabel: string;
}) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const actual = curve
    .filter((p) => p.day <= today && p.actual !== null)
    .map((p) => ({ day: p.day, v: p.actual ?? 0 }));
  const now = actual[actual.length - 1]?.v ?? 0;
  const { ticks, top } = niceTicks(Math.max(upper, predicted, now));
  const W = Math.max(width, 1);
  // Leave room at the right edge so the month-end ring (r4 + stroke) isn't clipped.
  const PW = Math.max(W - 6, 1);
  const x = (day: number) => ((day - 1) / Math.max(daysInMonth - 1, 1)) * PW;
  const y = (v: number) => H - (v / top) * H;
  const actualPath = actual
    .map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)} ${y(p.v).toFixed(1)}`)
    .join(" ");
  const from = `M${x(today).toFixed(1)} ${y(now).toFixed(1)} L`;
  const end = x(daysInMonth).toFixed(1);

  return (
    <div ref={ref} className="w-full max-w-[640px] pt-2 pb-5">
      {width > 0 ? (
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block overflow-visible"
          role="img"
          aria-label={`${monthLabel} 누적 지출과 월말 예상`}
        >
          {ticks.map((t) => (
            <line key={t} x1={0} x2={W} y1={y(t)} y2={y(t)} stroke="var(--line)" />
          ))}
          <line x1={0} x2={W} y1={H} y2={H} stroke="var(--line)" />
          <path
            d={`${from}${end} ${y(upper).toFixed(1)}`}
            fill="none"
            stroke="var(--ink3)"
            strokeWidth={1.25}
            strokeDasharray="2 4"
          />
          <path
            d={`${from}${end} ${y(lower).toFixed(1)}`}
            fill="none"
            stroke="var(--ink3)"
            strokeWidth={1.25}
            strokeDasharray="2 4"
          />
          <path
            d={`${from}${end} ${y(predicted).toFixed(1)}`}
            fill="none"
            stroke="var(--ink)"
            strokeWidth={2}
            strokeDasharray="6 5"
          />
          <path
            d={actualPath}
            fill="none"
            stroke="var(--ink)"
            strokeWidth={2.25}
            strokeLinejoin="round"
          />
          <circle cx={x(today)} cy={y(now)} r={4} fill="var(--ink)" />
          <circle
            cx={x(daysInMonth)}
            cy={y(predicted)}
            r={4}
            fill="var(--bg)"
            stroke="var(--ink)"
            strokeWidth={2}
          />
          {/* Tick labels last, haloed in the page colour so forecast lines pass behind them. */}
          {ticks.map((t) => (
            <text
              key={`l-${t}`}
              x={W}
              y={y(t) - 4}
              textAnchor="end"
              fontSize={11}
              fill="var(--ink3)"
              stroke="var(--bg)"
              strokeWidth={4}
              strokeLinejoin="round"
              paintOrder="stroke"
              className="num"
            >
              {tickLabel(t)}
            </text>
          ))}
          <text x={0} y={H} dy={16} fontSize={11} fill="var(--ink3)">
            1일
          </text>
          {today > 3 && today < daysInMonth - 3 ? (
            <text x={x(today)} y={H} dy={16} textAnchor="middle" fontSize={11} fill="var(--ink3)">
              {today}일
            </text>
          ) : null}
          <text x={W} y={H} dy={16} textAnchor="end" fontSize={11} fill="var(--ink3)">
            {daysInMonth}일
          </text>
        </svg>
      ) : (
        <div style={{ height: H }} />
      )}
    </div>
  );
}
