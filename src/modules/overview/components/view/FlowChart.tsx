"use client";

import { useEffect, useMemo, useState } from "react";
import { ChartAnnotation, Segmented, useDismissOnEvidence } from "@/components/ds";
import { evidenceMatches } from "@/lib/facts/evidence";
import { formatCount, formatWon, formatWonCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useStayDays } from "@/modules/overview/hooks";
import { tagEvidence, tagFamily } from "@/modules/overview/view/evidence-tag";
import type { FlowAnnotation, FlowMetric, FlowModel, FlowUnit } from "@/modules/overview/view/flow";
import { average, stayAnnotation } from "@/modules/overview/view/flow";
import { faceClass } from "./face-class";
import { useGrowClock } from "./useGrow";
import { useMeasuredWidth } from "./useMeasuredWidth";
import { useTaggedEvidence } from "./useTaggedEvidence";

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

/** Width of the left gutter holding the cash view's 입금/지출 axis labels. */
const CASH_GUTTER = 32;

function geometry(W: number, n: number, gutter = 0): Geometry {
  const wide = W >= 700;
  const top = wide ? 52 : 44;
  const plot = wide ? 190 : 150;
  const gap = n > 20 ? (wide ? 8 : 3) : n > 8 ? (wide ? 20 : 6) : wide ? 40 : 8;
  const barWidth = Math.max(1, (W - gutter - gap * (n - 1)) / n);
  return { W, top, plot, barWidth, gap, x: (i) => gutter + i * (barWidth + gap) };
}

/**
 * Cash flow: income up, spending down from a zero line, both on ONE scale. The
 * zero line sits where the two maxima split the plot, so neither side leaves an
 * empty band (each side keeps at least a fifth of the plot).
 */
interface CashScale {
  mid: number;
  k: number;
}

function cashScale(units: FlowUnit[], g: Geometry, reserveBelow: number): CashScale {
  const inMax = Math.max(0, ...units.map((u) => u.income ?? 0));
  const outMax = Math.max(0, ...units.map((u) => u.spending ?? 0));
  const share = Math.min(0.8, Math.max(0.2, inMax / Math.max(1, inMax + outMax)));
  const plot = g.plot - reserveBelow;
  const upper = plot * share;
  const k = Math.min(upper / Math.max(1, inMax), (plot - upper) / Math.max(1, outMax));
  return { mid: g.top + upper, k };
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
      unit.steps === null ? "기록 안 됨" : `${formatCount(unit.steps)}걸음`,
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
          <span className={cn("text-ink", faceClass(v))}>{v}</span>
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
  cash: CashScale
) {
  const x0 = g.x(a.from);
  const x1 = g.x(a.to) + g.barWidth;
  const cx = (x0 + x1) / 2;
  let barTop: number;
  if (metric === "cash") {
    const u = units[a.from];
    barTop = a.low
      ? cash.mid + Math.max(1.5, (u.spending ?? 0) * cash.k)
      : cash.mid - Math.max(1.5, (u.income ?? 0) * cash.k);
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
  const chosen = flow.available[picked] ? picked : (metrics[0]?.value ?? "commits");
  const [hover, setHover] = useState<number | null>(null);
  // A popover/annotation taking over clears the day tooltip (QA N3: it reappeared after Esc).
  useDismissOnEvidence(() => setHover(null));
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const units = flow.units;
  // Evidence for one of this chart's series (a cash fact about one day …) shows
  // that series while it is lit, so the highlight lands on the bars it is about.
  const { active, activeTag } = useTaggedEvidence(chosen);
  const family = activeTag ? tagFamily(activeTag) : null;
  const metric: FlowMetric =
    family !== null &&
    family !== chosen &&
    (family === "commits" || family === "steps" || family === "cash") &&
    flow.available[family] &&
    units.some((u) => evidenceMatches(active, u.key))
      ? family
      : chosen;
  const { stateOf, isActive } = useTaggedEvidence(metric);
  const n = Math.max(1, units.length);
  const grow = useGrowClock(600 + n * 20);
  const g = geometry(width, n, metric === "cash" ? CASH_GUTTER : 0);
  const yearly = units.length > 0 && units[0].key.length === 7;

  const max = Math.max(1, ...units.map((u) => value(u, metric) ?? 0));
  // A label hung under the deepest charge needs room above the day labels.
  const cash = cashScale(units, g, (flow.annotations.cash ?? []).some((a) => a.low) ? 22 : 0);
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
          <span className={faceClass(avgLabel)}>{avgLabel}</span>
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
                <line
                  x1={CASH_GUTTER}
                  x2={width}
                  y1={cash.mid}
                  y2={cash.mid}
                  stroke="var(--line)"
                />
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
                            y={cash.mid - Math.max(1.5, u.income * cash.k) * grow(i * 20)}
                            width={g.barWidth}
                            height={Math.max(1.5, u.income * cash.k) * grow(i * 20)}
                            rx={Math.min(1.5, g.barWidth / 3)}
                            fill={hov ? "var(--ink)" : lit ? "var(--brand)" : "var(--bar2)"}
                          />
                        ) : null}
                        {u.spending ? (
                          <rect
                            x={x}
                            y={cash.mid}
                            width={g.barWidth}
                            height={Math.max(1.5, u.spending * cash.k) * grow(i * 20)}
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
                        className={faceClass(u.label)}
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
                // Axis labels live in their own left gutter, clear of the first day's bars.
                <g pointerEvents="none" fontSize="11" fill="var(--ink3)">
                  <text x="0" y={cash.mid} dy="-5">
                    입금
                  </text>
                  <text x="0" y={cash.mid} dy="13">
                    지출
                  </text>
                </g>
              ) : null}
              {annotations.map((a) => {
                const ag = annotationGeometry(a, g, units, metric, max, cash);
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
                const ag = annotationGeometry(a, g, units, metric, max, cash);
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
                    evidence={tagEvidence(
                      a.from === a.to
                        ? { kind: "keys", keys: [units[a.from].key] }
                        : { kind: "range", from: units[a.from].key, to: units[a.to].key },
                      metric
                    )}
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
              `${u.title} 커밋 ${u.commits ?? (u.pending ? "계산 중" : "기록 없음")}, 지출 ${u.spending === null ? (u.pending ? "계산 중" : "기록 없음") : formatWon(u.spending)}`
          )
          .join(". ")}
      </p>
    </div>
  );
}
