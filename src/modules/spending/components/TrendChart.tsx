"use client";

import type { KeyboardEvent, PointerEvent } from "react";
import { ChartAnnotation, useEvidence } from "@/components/ds";
import type { FactEvidence, FactRow } from "@/lib/facts/types";
import { niceTicks, type TrendModel, tickLabel, trendValueAt } from "../view-model";
import { useElementWidth } from "./useElementWidth";

/** Plot height: phones keep the chart under a thumb's reach of the hero. */
export const TREND_H_SM = 184;
export const TREND_H = 232;
/** Below this container width the chart uses the phone height. */
const NARROW = 560;
/** Right gutter for the y tick labels ("600만" ≈ 30px at 11px) plus a gap from the ring. */
const LABEL_GUTTER = 44;

/** Stroke styles shared with the legend's line samples. */
export const TREND_STROKES = {
  actual: { stroke: "var(--ink)", width: 2.25, dash: undefined },
  previous: { stroke: "var(--ink3)", width: 1.5, dash: undefined },
  average: { stroke: "var(--ink3)", width: 1.75, dash: "0.5 4" },
  forecast: { stroke: "var(--ink)", width: 2, dash: "6 5" },
} as const;

export interface TrendAnnotation {
  day: number;
  label: string;
  rows: FactRow[];
  evidence?: FactEvidence;
}

function path(points: Array<[number, number]>): string {
  return points.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
}

/**
 * This month's cumulative spending (solid ink) against the reference months
 * (last month solid --ink3, the recent average dotted), today's marker, and the
 * month-end projection: a dashed line to the predicted total inside a shaded
 * wedge for the range. Hover, tap or ←/→ moves a day cursor; the legend beside
 * the chart reads that day.
 */
export function TrendChart({
  model,
  cursor,
  onCursor,
  monthLabel,
  annotation,
}: {
  model: TrendModel;
  cursor: number | null;
  onCursor: (day: number | null) => void;
  monthLabel: string;
  annotation?: TrendAnnotation | null;
}) {
  const { ref, width } = useElementWidth<HTMLElement>();
  const { stateOf, isActive } = useEvidence();
  // This month's line is evidence for every fact the block states (the
  // projection starts from it; the 의료·건강 jump and the pace are on it).
  const actualState = isActive
    ? ["forecast", "health", "rest"].some((k) => stateOf(k) === "on")
      ? "on"
      : "dim"
    : undefined;
  const { daysInMonth, today, actual, now, references, forecast } = model;
  const H = width > 0 && width < NARROW ? TREND_H_SM : TREND_H;
  const max = Math.max(
    now,
    forecast?.mid ?? 0,
    forecast?.range?.upper ?? 0,
    ...references.map((r) => r.values[r.values.length - 1] ?? 0)
  );
  const { ticks, top } = niceTicks(max);
  const W = Math.max(width, 1);
  const PW = Math.max(W - LABEL_GUTTER, 1);
  const x = (day: number) => ((day - 1) / Math.max(daysInMonth - 1, 1)) * PW;
  const y = (v: number) => H - (v / top) * H;

  const actualPath = path(actual.map((v, i) => [x(i + 1), y(v)]));
  const refPaths = references.map((r) => ({
    key: r.key,
    d: path(r.values.map((v, i) => [x(i + 1), y(v)])),
  }));
  const tx = x(today);
  const ty = y(now);
  const end = x(daysInMonth);

  const dayAt = (clientX: number, rect: DOMRect) => {
    const px = Math.min(Math.max(clientX - rect.left, 0), PW);
    return Math.round((px / PW) * (daysInMonth - 1)) + 1;
  };
  const onPointer = (e: PointerEvent<SVGRectElement>) =>
    onCursor(dayAt(e.clientX, e.currentTarget.getBoundingClientRect()));
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    const from = cursor ?? today;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const step = e.key === "ArrowLeft" ? -1 : 1;
      onCursor(Math.min(Math.max(from + step, 1), daysInMonth));
    } else if (e.key === "Escape") onCursor(null);
  };

  const cursorDots =
    cursor === null
      ? []
      : [
          ...references.map((r) => ({
            key: r.key,
            v: r.values[cursor - 1] ?? null,
            fill: "var(--ink3)",
          })),
          { key: "actual", v: trendValueAt(model, cursor), fill: "var(--ink)" },
        ].filter((d): d is { key: string; v: number; fill: string } => d.v !== null);

  const ann =
    annotation && annotation.day >= 1 && annotation.day <= today && width > 0
      ? (() => {
          const ax = x(annotation.day);
          const ay = y(actual[annotation.day - 1] ?? 0);
          const labelTop = Math.max(-12, ay - 48);
          return {
            x: ax,
            top: labelTop,
            leader: Math.max(8, ay - labelTop - 16 - 6),
            side: ax > PW * 0.6 ? ("left" as const) : ("right" as const),
          };
        })()
      : null;

  return (
    <figure
      ref={ref}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: ←/→ move the chart's day cursor
      tabIndex={0}
      onKeyDown={onKey}
      onBlur={() => onCursor(null)}
      aria-label="날짜별 누적 보기 — 왼쪽·오른쪽 화살표로 날짜를 옮겨요"
      className="relative m-0 w-full rounded-md pt-5 pb-6 outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
    >
      {width > 0 ? (
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block overflow-visible"
          role="img"
          aria-label={`${monthLabel} 누적 지출과 월말 예상`}
          data-trend-chart=""
        >
          {ticks.map((t) => (
            <line key={t} x1={0} x2={W} y1={y(t)} y2={y(t)} stroke="var(--line)" />
          ))}
          <line x1={0} x2={W} y1={H} y2={H} stroke="var(--line)" />

          {/* Today: a hairline down the plot, behind every series. */}
          <line
            x1={tx}
            x2={tx}
            y1={0}
            y2={H}
            stroke="var(--ink3)"
            strokeOpacity={0.35}
            strokeDasharray="2 3"
          />

          {forecast?.range ? (
            <path
              data-series="range"
              data-evidence={stateOf("forecast")}
              d={`M${tx.toFixed(1)} ${ty.toFixed(1)} L${end.toFixed(1)} ${y(forecast.range.upper).toFixed(1)} L${end.toFixed(1)} ${y(forecast.range.lower).toFixed(1)} Z`}
              fill="color-mix(in oklab, var(--ink) 8%, transparent)"
            />
          ) : null}

          {refPaths.map((r) => {
            const s = TREND_STROKES[r.key];
            return (
              <path
                key={r.key}
                data-series={r.key}
                d={r.d}
                fill="none"
                stroke={s.stroke}
                strokeOpacity={r.key === "previous" ? 0.7 : 1}
                strokeWidth={s.width}
                strokeDasharray={s.dash}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}

          {forecast ? (
            <path
              data-series="forecast"
              data-evidence={stateOf("forecast")}
              d={`M${tx.toFixed(1)} ${ty.toFixed(1)} L${end.toFixed(1)} ${y(forecast.mid).toFixed(1)}`}
              fill="none"
              stroke={TREND_STROKES.forecast.stroke}
              strokeWidth={TREND_STROKES.forecast.width}
              strokeDasharray={TREND_STROKES.forecast.dash}
            />
          ) : null}

          <path
            data-series="actual"
            data-evidence={actualState}
            d={actualPath}
            fill="none"
            stroke={TREND_STROKES.actual.stroke}
            strokeWidth={TREND_STROKES.actual.width}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {forecast ? (
            <circle
              cx={end}
              cy={y(forecast.mid)}
              r={4}
              fill="var(--bg)"
              stroke="var(--ink)"
              strokeWidth={2}
            />
          ) : null}
          {/* Today's point, haloed so the lines behind it stay legible. */}
          <circle cx={tx} cy={ty} r={5} fill="var(--ink)" stroke="var(--bg)" strokeWidth={2.5} />

          {cursor !== null ? (
            <g data-cursor={cursor}>
              <line x1={x(cursor)} x2={x(cursor)} y1={0} y2={H} stroke="var(--ink2)" />
              {cursorDots.map((d) => (
                <circle
                  key={d.key}
                  cx={x(cursor)}
                  cy={y(d.v)}
                  r={3.5}
                  fill={d.fill}
                  stroke="var(--bg)"
                  strokeWidth={2}
                />
              ))}
            </g>
          ) : null}

          {/* Tick labels last, haloed in the page colour so lines pass behind them. */}
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
          {cursor !== null && cursor > 2 && cursor < daysInMonth - 2 ? (
            <text
              x={x(cursor)}
              y={H}
              dy={16}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              fill="var(--ink)"
            >
              {cursor}일
            </text>
          ) : cursor === null && today > 2 && today < daysInMonth - 2 ? (
            <text
              x={tx}
              y={H}
              dy={16}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              fill="var(--ink)"
            >
              오늘
            </text>
          ) : null}
          <text x={PW} y={H} dy={16} textAnchor="end" fontSize={11} fill="var(--ink3)">
            {daysInMonth}일
          </text>

          {/* The pointer surface: the whole plot, last so it is on top. */}
          <rect
            x={0}
            y={0}
            width={PW}
            height={H}
            fill="transparent"
            style={{ touchAction: "pan-y" }}
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") onCursor(null);
            }}
          />
        </svg>
      ) : (
        // Same height the measured chart will take, so nothing below it jumps.
        <div className="h-[184px] sm:h-[232px]" />
      )}
      {ann && annotation ? (
        <ChartAnnotation
          x={ann.x}
          top={ann.top + 20}
          leader={ann.leader}
          side={ann.side}
          label={annotation.label}
          rows={annotation.rows}
          evidence={annotation.evidence}
          numeric
        />
      ) : null}
    </figure>
  );
}
