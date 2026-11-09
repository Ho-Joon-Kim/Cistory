"use client";

import { useEffect, useMemo, useState } from "react";
import { ChartAnnotation, Segmented, useDismissOnEvidence, useEvidence } from "@/components/ds";
import { formatCount, formatWon, formatWonCompact } from "@/lib/format";
import { useStayDays } from "@/modules/overview/hooks";
import type { FlowAnnotation, FlowMetric, FlowModel, FlowUnit } from "@/modules/overview/view/flow";
import { average, stayAnnotation } from "@/modules/overview/view/flow";
import { useGrowClock } from "./useGrow";
import { useMeasuredWidth } from "./useMeasuredWidth";

const METRICS: { value: FlowMetric; label: string }[] = [
  { value: "commits", label: "커밋" },
  { value: "steps", label: "걸음" },
  { value: "cash", label: "현금흐름" },
];

interface Geometry {
  W: number;
  top: number;
  plot: number;
  barWidth: number;
  gap: number;
  x: (i: number) => number;
}

function geometry(W: number, n: number): Geometry {
  const wide = W >= 700;
  const top = wide ? 52 : 44;
  const plot = wide ? 190 : 150;
  const gap = n > 20 ? (wide ? 8 : 3) : n > 8 ? (wide ? 20 : 6) : wide ? 40 : 8;
  const barWidth = Math.max(1, (W - gap * (n - 1)) / n);
  return { W, top, plot, barWidth, gap, x: (i) => i * (barWidth + gap) };
}

function value(u: FlowUnit, metric: FlowMetric) {
  return metric === "commits" ? u.commits : metric === "steps" ? u.steps : null;
}

function Tooltip({
  unit,
  left,
  width,
  yearly,
}: {
  unit: FlowUnit;
  left: number;
  width: number;
  yearly: boolean;
}) {
  const rows: [string, string][] = [
    ["커밋", unit.commits === null ? "기록 안 됨" : formatCount(unit.commits)],
    [
      yearly ? "하루 평균 걸음" : "걸음",
      unit.steps === null ? "기록 안 됨" : `${formatCount(unit.steps)}보`,
    ],
    ["지출", unit.spending === null ? "기록 안 됨" : formatWonCompact(unit.spending)],
  ];
  if (unit.income) rows.push(["입금", formatWonCompact(unit.income)]);
  return (
    <div
      className="pointer-events-none absolute top-0 z-20 rounded-[10px] bg-surface px-3 py-2.5 text-xs leading-[18px] shadow-pop"
      style={{ left, width }}
    >
      <div className="mb-1 font-semibold text-ink">{unit.title}</div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 text-ink-2">
          <span>{k}</span>
          <span className="num text-ink">{v}</span>
        </div>
      ))}
    </div>
  );
}

function annotationGeometry(
  a: FlowAnnotation,
  g: Geometry,
  units: FlowUnit[],
  metric: FlowMetric,
  max: number,
  cashMax: number
) {
  const x0 = g.x(a.from);
  const x1 = g.x(a.to) + g.barWidth;
  const cx = (x0 + x1) / 2;
  const half = g.plot / 2;
  let barTop: number;
  if (metric === "cash") {
    const u = units[a.from];
    barTop = a.low
      ? g.top + half + Math.max(1.5, ((u.spending ?? 0) / cashMax) * half)
      : g.top + half - Math.max(1.5, ((u.income ?? 0) / cashMax) * half);
  } else {
    let m = 0;
    for (let k = a.from; k <= a.to; k++) m = Math.max(m, value(units[k], metric) ?? 0);
    barTop = g.top + g.plot - (m / max) * g.plot;
  }
  const labelTop = a.lane ? 22 : 4;
  const span = a.to > a.from;
  const bracketY = Math.min(barTop - 6, labelTop + 26);
  return { x0, x1, cx, barTop, labelTop, span, bracketY };
}

/**
 * Period rhythm: bars per day (or month) for the chosen KPI, the period average as
 * a dashed rule, 1–3 annotations whose labels open their evidence, hover tooltip
 * with every KPI for that day.
 */
export function FlowChart({ flow, label }: { flow: FlowModel; label: string }) {
  const metrics = METRICS.filter((m) => flow.available[m.value]);
  const [picked, setPicked] = useState<FlowMetric>(metrics[0]?.value ?? "commits");
  const metric = flow.available[picked] ? picked : (metrics[0]?.value ?? "commits");
  const [hover, setHover] = useState<number | null>(null);
  // A popover/annotation taking over clears the day tooltip (QA N3: it reappeared after Esc).
  useDismissOnEvidence(() => setHover(null));
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const { stateOf, isActive } = useEvidence();
  const units = flow.units;
  const n = Math.max(1, units.length);
  const grow = useGrowClock(600 + n * 20);
  const g = geometry(width, n);
  const yearly = units.length > 0 && units[0].key.length === 7;

  const max = Math.max(1, ...units.map((u) => value(u, metric) ?? 0));
  const cashMax = Math.max(1, ...units.map((u) => Math.max(u.income ?? 0, u.spending ?? 0)));
  const half = g.plot / 2;
  const base = g.top + g.plot;
  const height = base + 26;
  const avg =
    metric === "cash" ? null : average(units.filter((u) => !u.future).map((u) => value(u, metric)));
  const avgY = avg === null ? 0 : base - (avg / max) * g.plot;
  const stayDays = useStayDays(flow.stayFocus);
  const stay = useMemo(
    () => (flow.stayFocus ? stayAnnotation(units, flow.stayFocus, stayDays) : null),
    [flow.stayFocus, units, stayDays]
  );
  const annotations = useMemo(() => {
    const base = flow.annotations[metric] ?? [];
    // The area span shares lane 1 with trip spans; a trip already covering it wins.
    if (metric !== "commits" || !stay) return base;
    const clash = base.some((a) => a.lane === 1 && a.from <= stay.to && a.to >= stay.from);
    return clash ? base : [...base, stay];
  }, [flow.annotations, metric, stay]);
  const tipWidth = width >= 700 ? 196 : 168;
  // An evidence popover owns the chart while it is open: drop the day tooltip
  // so a stale hover can't come back beside it once the popover closes.
  useEffect(() => {
    if (isActive) setHover(null);
  }, [isActive]);
  const avgLabel =
    metric === "commits"
      ? flow.averageLabel.commits
      : metric === "steps"
        ? flow.averageLabel.steps
        : null;

  if (metrics.length === 0) return null;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 font-serif text-[22px] leading-[30px] font-semibold tracking-[-0.02em] text-ink">
          흐름
        </h2>
        <Segmented
          items={metrics}
          value={metric}
          onChange={(v) => {
            setPicked(v);
            setHover(null);
          }}
          ariaLabel="차트 지표"
          className="sm:[&>button]:min-w-[78px]"
        />
      </div>
      {avg !== null && avg > 0 && avgLabel ? (
        // The average rule's label lives in a legend on clear background, never over the bars.
        <p className="m-0 mb-2 flex items-center gap-2 text-[11px] leading-4 text-ink-2">
          <svg width="18" height="2" aria-hidden="true" className="shrink-0">
            <line x1="0" x2="18" y1="1" y2="1" stroke="var(--ink2)" strokeDasharray="4 3" />
          </svg>
          <span className="num">{avgLabel}</span>
        </p>
      ) : null}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover tooltip is a pointer enhancement; the values are in the chart label */}
      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        {width > 0 ? (
          <>
            <svg
              width={width}
              height={height}
              role="img"
              aria-label={`${label} ${METRICS.find((m) => m.value === metric)?.label} 흐름${
                metric === "cash"
                  ? ""
                  : ` · ${metric === "commits" ? flow.averageLabel.commits : flow.averageLabel.steps}`
              }`}
              className="block overflow-visible"
            >
              <line x1="0" x2={width} y1={base} y2={base} stroke="var(--line)" />
              {metric === "cash" ? (
                <line x1="0" x2={width} y1={g.top + half} y2={g.top + half} stroke="var(--line)" />
              ) : null}
              {units.map((u, i) => {
                const x = g.x(i);
                const evidence = stateOf(u.key);
                const lit = evidence === "on";
                const hov = hover === i;
                const fillMain = hov
                  ? "var(--ink)"
                  : lit
                    ? "var(--brand)"
                    : u.partial
                      ? "var(--bar)"
                      : "var(--bar2)";
                const v = value(u, metric);
                return (
                  // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only tooltip hover
                  <g
                    key={u.key}
                    data-evidence={isActive ? evidence : undefined}
                    onMouseEnter={() => setHover(i)}
                    onPointerUp={(e) => {
                      // Touch has no hover: a tap shows (or hides) that day's values.
                      if (e.pointerType !== "mouse") setHover((h) => (h === i ? null : i));
                    }}
                  >
                    <rect
                      x={x}
                      y={0}
                      width={g.barWidth + g.gap}
                      height={height}
                      fill="transparent"
                    />
                    {metric !== "cash" && v !== null && v > 0 ? (
                      <rect
                        x={x}
                        y={base - Math.max(2, (v / max) * g.plot) * grow(i * 20)}
                        width={g.barWidth}
                        height={Math.max(2, (v / max) * g.plot) * grow(i * 20)}
                        rx={Math.min(2, g.barWidth / 3)}
                        fill={fillMain}
                      />
                    ) : null}
                    {metric === "steps" && v === null && !u.future ? (
                      <rect
                        x={x}
                        y={base - 1}
                        width={g.barWidth}
                        height={1}
                        fill="none"
                        stroke="var(--line)"
                        strokeDasharray="2 2"
                      />
                    ) : null}
                    {metric === "cash" && u.spending !== null ? (
                      <>
                        {u.income ? (
                          <rect
                            x={x}
                            y={
                              g.top +
                              half -
                              Math.max(1.5, (u.income / cashMax) * half) * grow(i * 20)
                            }
                            width={g.barWidth}
                            height={Math.max(1.5, (u.income / cashMax) * half) * grow(i * 20)}
                            rx={Math.min(1.5, g.barWidth / 3)}
                            fill={hov ? "var(--ink)" : lit ? "var(--brand)" : "var(--bar2)"}
                          />
                        ) : null}
                        {u.spending ? (
                          <rect
                            x={x}
                            y={g.top + half}
                            width={g.barWidth}
                            height={Math.max(1.5, (u.spending / cashMax) * half) * grow(i * 20)}
                            rx={Math.min(1.5, g.barWidth / 3)}
                            fill={hov ? "var(--ink)" : lit ? "var(--brand)" : "var(--ink2)"}
                          />
                        ) : null}
                      </>
                    ) : null}
                    {u.showLabel ? (
                      <text
                        x={x + g.barWidth / 2}
                        y={base + 18}
                        textAnchor="middle"
                        fontSize="11"
                        fill="var(--ink3)"
                        className="num"
                      >
                        {u.label}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              {avg !== null && avg > 0 ? (
                <g pointerEvents="none">
                  <line
                    x1="0"
                    x2={width}
                    y1={avgY}
                    y2={avgY}
                    stroke="var(--ink2)"
                    strokeDasharray="4 4"
                  />
                </g>
              ) : null}
              {metric === "cash" ? (
                <g pointerEvents="none" fontSize="11" fill="var(--ink3)">
                  <text x="0" y={g.top + half} dy="-8">
                    입금
                  </text>
                  <text x="0" y={g.top + half} dy="16">
                    지출
                  </text>
                </g>
              ) : null}
              {annotations.map((a) => {
                const ag = annotationGeometry(a, g, units, metric, max, cashMax);
                if (a.low) return null;
                return (
                  <g key={a.id} pointerEvents="none" stroke="var(--ink3)" fill="none">
                    {ag.span ? <path d={`M${ag.x0} ${ag.bracketY} v-4 H${ag.x1} v4`} /> : null}
                    <line
                      x1={ag.cx}
                      x2={ag.cx}
                      y1={ag.span ? ag.bracketY : ag.labelTop + 18}
                      y2={ag.barTop - 2}
                    />
                    {ag.span ? (
                      <line x1={ag.cx} x2={ag.cx} y1={ag.labelTop + 18} y2={ag.bracketY - 4} />
                    ) : null}
                  </g>
                );
              })}
            </svg>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: clears the hover tooltip; the labels inside are the controls */}
            <div className="contents" onPointerEnter={() => setHover(null)}>
              {annotations.map((a) => {
                const ag = annotationGeometry(a, g, units, metric, max, cashMax);
                const right = ag.cx > width * 0.62;
                const top = a.low ? Math.min(base + 2, ag.barTop + 8) : ag.labelTop;
                return (
                  <ChartAnnotation
                    key={a.id}
                    x={ag.cx}
                    top={top}
                    leader={0}
                    side={right ? "left" : "right"}
                    label={width < 700 && a.shortLabel ? a.shortLabel : a.label}
                    rows={a.rows}
                    evidence={
                      a.from === a.to
                        ? { kind: "keys", keys: [units[a.from].key] }
                        : { kind: "range", from: units[a.from].key, to: units[a.to].key }
                    }
                  />
                );
              })}
            </div>
            {hover !== null && units[hover] && !isActive ? (
              <Tooltip
                unit={units[hover]}
                yearly={yearly}
                width={tipWidth}
                left={Math.max(
                  0,
                  Math.min(width - tipWidth, g.x(hover) + g.barWidth / 2 - tipWidth / 2)
                )}
              />
            ) : null}
          </>
        ) : (
          <div style={{ height: 268 }} />
        )}
      </div>
      <p className="sr-only">
        {units
          .filter((u) => !u.future)
          .map(
            (u) =>
              `${u.title} 커밋 ${u.commits ?? "기록 없음"}, 지출 ${u.spending === null ? "기록 없음" : formatWon(u.spending)}`
          )
          .join(". ")}
      </p>
    </div>
  );
}
