"use client";

import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AiLine, EmptyState, Segmented, useDismissOnEvidence, useEvidence } from "@/components/ds";
import {
  formatDateRange,
  formatDay,
  formatMonthDay,
  formatReturn,
  formatWon,
  formatWonCompact,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  axisTickIndices,
  type Box,
  boxesOverlap,
  labelWidth,
  placeAxisLabel,
  placeCallout,
  polylineHitsBox,
} from "../chart-layout";
import { chartFact, evidenceKey } from "../facts";
import {
  type AssetPoint,
  type Cashflow,
  cashflowsInRange,
  niceScale,
  pointPnl,
  rangeExtremes,
  sliceSeries,
} from "../view-model";
import {
  ChangeArrow,
  enterStyle,
  marketTone,
  SectionTitle,
  useElementWidth,
  useIsDesktop,
} from "./parts";

const RANGES = [
  { value: "7", label: "7일", days: 7 },
  { value: "30", label: "30일", days: 30 },
  { value: "90", label: "90일", days: 90 },
  { value: "365", label: "1년", days: 365 },
] as const;
type RangeKey = (typeof RANGES)[number]["value"];

const PAD_TOP = 40;
const PAD_BOTTOM = 44;

interface Annotation {
  key: string;
  /** The annotated point. */
  x: number;
  y: number;
  /** Label box (px). */
  left: number;
  top: number;
  text: string;
  /** Leader end on the label box. */
  leader: { x: number; y: number };
}

const ANN_H = 18;
/** px-1 padding around the callout text. */
const ANN_PAD = 8;
const AXIS_FONT = 11;

/**
 * A chart callout at its placed box. Measured after layout and nudged only if
 * the real text runs wider than the estimate (so it never leaves the chart).
 */
function AnnotationLabel({ a, width }: { a: Annotation; width: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [left, setLeft] = useState<number | null>(null);
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 0;
    setLeft(Math.max(0, Math.min(width - w, a.left)));
  }, [a.left, width]);
  return (
    <span
      ref={ref}
      className="num pointer-events-none absolute bg-page px-1 py-px text-xs leading-4 whitespace-nowrap text-ink"
      style={{ left: left ?? a.left, top: a.top, visibility: left === null ? "hidden" : undefined }}
    >
      {a.text}
    </span>
  );
}

function annBox(a: Annotation, w: number): Box {
  return { x0: a.left, x1: a.left + w, y0: a.top, y1: a.top + ANN_H };
}

export function AssetTrend({ series, cashflows }: { series: AssetPoint[]; cashflows: Cashflow[] }) {
  const [range, setRange] = useState<RangeKey>("30");
  const [hover, setHover] = useState<number | null>(null);
  /** A touch put the crosshair down: it stays after lift until a tap elsewhere. */
  const [pinned, setPinned] = useState(false);
  useDismissOnEvidence(() => {
    setHover(null);
    setPinned(false);
  });
  const [boxRef, width] = useElementWidth<HTMLDivElement>();
  const desktop = useIsDesktop();
  const { stateOf, active } = useEvidence();
  const cfLit = active !== null && stateOf(evidenceKey.cashflows) === "on";

  const def = RANGES.find((r) => r.value === range) ?? RANGES[1];
  const pts = useMemo(() => sliceSeries(series, def.days), [series, def.days]);
  const cfs = useMemo(() => cashflowsInRange(cashflows, pts), [cashflows, pts]);
  const n = pts.length;
  const first = pts[0];
  const last = pts[n - 1];
  const ext = useMemo(() => rangeExtremes(pts), [pts]);

  const fact = useMemo(() => {
    if (n < 2) return null;
    return chartFact({
      period: { from: first.date, to: last.date, label: def.label },
      rangeLabel: def.label,
      startValue: first.value,
      endValue: last.value,
      cashflows: cfs,
      peak: ext.peak !== n - 1 ? { date: pts[ext.peak].date, value: pts[ext.peak].value } : null,
      low:
        ext.lowAfterPeak !== ext.peak
          ? { date: pts[ext.lowAfterPeak].date, value: pts[ext.lowAfterPeak].value }
          : null,
    });
  }, [n, first, last, def.label, cfs, ext, pts]);

  const H = desktop ? 320 : 240;
  const W = width;
  const plotH = H - PAD_TOP - PAD_BOTTOM;

  const geo = useMemo(() => {
    if (n < 2 || W <= 0) return null;
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const p of pts) {
      lo = Math.min(lo, p.value, p.invested);
      hi = Math.max(hi, p.value, p.invested);
    }
    const scale = niceScale(lo, hi);
    const xAt = (j: number) => 1 + (j * (W - 2)) / (n - 1);
    const yAt = (v: number) => PAD_TOP + ((scale.max - v) / (scale.max - scale.min)) * plotH;
    const path = (key: "value" | "invested") =>
      pts.map((p, j) => `${j ? "L" : "M"}${xAt(j).toFixed(1)} ${yAt(p[key]).toFixed(1)}`).join("");
    const line = path("value");
    const inv = path("invested");
    const base = PAD_TOP + plotH;
    const area = `${line}L${xAt(n - 1).toFixed(1)} ${base}L${xAt(0).toFixed(1)} ${base}Z`;

    // Screen-space polylines: every label below is placed off both lines.
    const valuePts = pts.map((p, j) => ({ x: xAt(j), y: yAt(p.value) }));
    const costPts = pts.map((p, j) => ({ x: xAt(j), y: yAt(p.invested) }));
    const lines = [valuePts, costPts];

    // Y-axis labels: always directly above their own grid line — at the left
    // edge, else the right edge, else dropped. Never shifted below the line
    // (it would read as the next line's value) and never haloed over the data.
    // Placed first so callouts treat them as soft obstacles.
    const grid: Array<{
      y: number;
      label: string;
      labelX: number;
      labelY: number;
      anchor: "start" | "end";
      box: Box;
      show: boolean;
    }> = [];
    for (let v = scale.min; v <= scale.max + 1; v += scale.step) {
      const y = yAt(v);
      const label = formatWonCompact(v);
      const spot = placeAxisLabel({
        y,
        w: labelWidth(label, AXIS_FONT) + 4,
        width: W,
        lines,
        avoid: grid.filter((g) => g.show).map((g) => g.box),
      });
      grid.push(
        spot
          ? {
              y,
              label,
              labelX: spot.x,
              labelY: spot.baseline,
              anchor: spot.anchor,
              box: spot.box,
              show: true,
            }
          : {
              y,
              label,
              labelX: 0,
              labelY: y,
              anchor: "start",
              box: { x0: 0, x1: 0, y0: y, y1: y },
              show: false,
            }
      );
    }

    const ann: Annotation[] = [];
    const place = (j: number, preferAbove: boolean, text: string, key: string) => {
      const p = valuePts[j];
      const w = labelWidth(text) + ANN_PAD;
      const spot = placeCallout({
        p,
        w,
        h: ANN_H,
        preferAbove,
        width: W,
        top: 0,
        bottom: base - 2,
        lines,
        avoid: ann.map((a) => annBox(a, w)),
        soft: grid.map((g) => g.box),
      });
      if (!spot) return;
      ann.push({
        key,
        x: p.x,
        y: p.y,
        left: spot.box.x0,
        top: spot.box.y0,
        text,
        leader: spot.leader,
      });
    };
    if (ext.peak !== n - 1) {
      place(
        ext.peak,
        true,
        `고점 ${formatMonthDay(pts[ext.peak].date)} · ${formatWon(pts[ext.peak].value)}`,
        "peak"
      );
    }
    if (ext.lowAfterPeak !== ext.peak) {
      const dd = pts[ext.lowAfterPeak].value / pts[ext.peak].value - 1;
      const extra =
        desktop && ext.biggestDrop === ext.lowAfterPeak
          ? ` · 하루 ${formatWon(ext.drop, { sign: true })}`
          : "";
      place(
        ext.lowAfterPeak,
        false,
        `저점 ${formatMonthDay(pts[ext.lowAfterPeak].date)} · 고점 대비 ${formatReturn(dd)}${extra}`,
        "low"
      );
    }
    const annBoxes = ann.flatMap((a) => {
      const box = annBox(a, labelWidth(a.text) + ANN_PAD);
      // The leader from the point to its label.
      const leader = {
        x0: Math.min(a.x, a.leader.x) - 2,
        x1: Math.max(a.x, a.leader.x) + 2,
        y0: Math.min(a.y, a.leader.y),
        y1: Math.max(a.y, a.leader.y),
      };
      return [box, leader];
    });
    // An axis label a callout still covers gives way to the callout.
    for (const g of grid) g.show &&= !annBoxes.some((b) => boxesOverlap(b, g.box, 1));

    // "매입금액" at the cost line's right end: below it, else above, then a
    // step further out — clear of both lines, the callouts and the axis labels.
    const invEnd = costPts[n - 1].y;
    const invW = labelWidth("매입금액");
    const invBox = (ly: number): Box => ({ x0: W - invW, x1: W, y0: ly - 12, y1: ly + 2 });
    const invSpots = [16, -6, 30, -20, 44, -34]
      .map((d) => invEnd + d)
      .filter((ly) => ly - 12 >= 0 && ly + 2 < base);
    const shownAxis = grid.filter((g) => g.show).map((g) => g.box);
    const invFree = (ly: number) =>
      ![...annBoxes, ...shownAxis].some((b) => boxesOverlap(b, invBox(ly), 1));
    const invLabelY =
      invSpots.find((ly) => invFree(ly) && !lines.some((l) => polylineHitsBox(l, invBox(ly), 1))) ??
      invSpots.find(invFree) ??
      null;
    const invLabelShow = invLabelY !== null;

    // X-axis: every day when they fit, else evenly spaced back from the latest.
    const xl = axisTickIndices(n, Math.max(2, Math.floor(W / (desktop ? 110 : 90)))).map((j) => {
      const x = xAt(j);
      const label = formatMonthDay(pts[j].date);
      const half = labelWidth(label, AXIS_FONT) / 2;
      return {
        x,
        label,
        anchor: x - half < 0 ? "start" : x + half > W ? "end" : "middle",
      } as const;
    });

    const markers = cfs.map((c) => {
      let j = 0;
      for (let q = 0; q < n; q++) if (pts[q].date <= c.date) j = q;
      return { key: `${c.date}-${c.amount}`, x: xAt(j) };
    });

    return {
      xAt,
      yAt,
      line,
      inv,
      area,
      ann,
      grid,
      xl,
      markers,
      base,
      invLabelY: invLabelY ?? 0,
      invLabelShow,
    };
  }, [n, W, pts, plotH, ext, desktop, cfs]);

  const onPointer = (e: PointerEvent<SVGRectElement>) => {
    if (!geo) return;
    // Touch/pen: keep receiving moves while the finger scrubs sideways.
    if (e.type === "pointerdown" && e.pointerType !== "mouse") {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setPinned(true);
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const j = Math.round(((x - 1) / Math.max(1, W - 2)) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, j)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const step = e.key === "ArrowLeft" ? -1 : 1;
      setHover((h) => Math.min(n - 1, Math.max(0, (h ?? n - 1) + step)));
    } else if (e.key === "Escape") setHover(null);
  };

  useEffect(() => {
    if (!pinned) return;
    const onDown = (event: globalThis.PointerEvent) => {
      if ((event.target as Element | null)?.closest?.("[data-asset-trend]")) return;
      setPinned(false);
      setHover(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [pinned]);

  const change = n >= 2 ? last.value - first.value : 0;
  const hv = hover !== null && hover < n && geo ? pts[hover] : null;

  return (
    <section
      aria-labelledby="pf-trend"
      className="ds-enter mt-8 border-b border-line pb-7 lg:mt-12 lg:pb-12"
      style={enterStyle(3)}
    >
      <div className="flex flex-col gap-3.5 lg:flex-row lg:items-center lg:justify-between">
        <div id="pf-trend">
          <SectionTitle>자산 추이</SectionTitle>
        </div>
        <Segmented
          items={RANGES.map(({ value, label }) => ({ value, label }))}
          value={range}
          onChange={(v) => {
            setRange(v);
            setHover(null);
            setPinned(false);
          }}
          ariaLabel="기간"
          className="lg:[&>button]:w-16"
        />
      </div>

      {n < 2 ? (
        <EmptyState
          className="mt-6"
          title="추이를 그릴 기록이 아직 부족해요"
          description="모든 계좌의 평가 기록이 이틀 이상 쌓이면 여기에 그려져요."
        />
      ) : (
        <>
          <div className="mt-3.5 text-[13px] leading-5 text-ink-2 lg:mt-3 lg:flex lg:items-baseline lg:gap-3 lg:text-sm">
            <span className="block lg:inline">
              <span className="num">{formatDateRange(first.date, last.date)}</span>
              <span className="hidden lg:inline"> · </span>
            </span>
            <span className="block lg:inline">
              <span className="num">{formatWon(first.value)}</span> →{" "}
              <span className="num">{formatWon(last.value)}</span>
            </span>
            <span
              className={cn("num inline-flex items-center gap-1 font-semibold", marketTone(change))}
            >
              <ChangeArrow value={change} size={13} />
              {formatWon(change, { sign: true })} ({formatReturn(last.value / first.value - 1)})
            </span>
          </div>
          {fact ? (
            <div className="mt-1.5 max-w-[760px]">
              <AiLine fact={fact} rows={fact.rows} className="max-lg:text-wrap" />
            </div>
          ) : null}

          <div
            ref={boxRef}
            data-asset-trend=""
            className="relative mt-3 lg:mt-4"
            style={{ height: H }}
          >
            {geo ? (
              <>
                <svg
                  width={W}
                  height={H}
                  viewBox={`0 0 ${W} ${H}`}
                  className="block overflow-visible outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-4 focus-visible:outline-brand"
                  role="img"
                  aria-label={`평가금액과 매입금액 추이, ${formatDateRange(first.date, last.date)}. 좌우 화살표로 날짜별 값을 볼 수 있어요.`}
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: arrow keys move the crosshair
                  tabIndex={0}
                  onKeyDown={onKey}
                  onBlur={() => {
                    if (!pinned) setHover(null);
                  }}
                  style={{ touchAction: "pan-y" }}
                >
                  {geo.grid.map((g) => (
                    <line
                      key={g.y}
                      x1={0}
                      x2={W}
                      y1={g.y}
                      y2={g.y}
                      stroke="var(--line)"
                      strokeWidth={1}
                    />
                  ))}
                  <path
                    d={geo.area}
                    fill="var(--ink)"
                    fillOpacity={0.05}
                    className="ds-delayed-in"
                    style={{ animationFillMode: "backwards" }}
                  />
                  <path
                    d={geo.inv}
                    fill="none"
                    stroke="var(--ink3)"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                  />
                  <path
                    d={geo.line}
                    fill="none"
                    stroke="var(--ink)"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    opacity={cfLit ? 0.5 : 1}
                    style={{ transition: "opacity 150ms ease-out" }}
                  />
                  {/* Axis labels sit on their grid lines, placed clear of the data (no halo). */}
                  {geo.grid.map((g) =>
                    g.show ? (
                      <text
                        key={`l-${g.y}`}
                        x={g.labelX}
                        y={g.labelY}
                        textAnchor={g.anchor}
                        fontSize={AXIS_FONT}
                        fill="var(--ink3)"
                        fontFamily="var(--font-mono)"
                      >
                        {g.label}
                      </text>
                    ) : null
                  )}
                  {geo.invLabelShow ? (
                    <text x={W} y={geo.invLabelY} textAnchor="end" fontSize={12} fill="var(--ink3)">
                      매입금액
                    </text>
                  ) : null}
                  {geo.markers.map((m) => (
                    <circle
                      key={m.key}
                      cx={m.x}
                      cy={geo.base}
                      r={cfLit ? 4 : 3}
                      fill={cfLit ? "var(--brand)" : "var(--ink3)"}
                      opacity={cfLit ? 1 : 0.35}
                      style={{ transition: "opacity 150ms ease-out, fill 150ms ease-out" }}
                    />
                  ))}
                  {geo.ann.map((a) => (
                    <g key={a.key}>
                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={a.leader.x}
                        y2={a.leader.y}
                        stroke="var(--ink3)"
                        strokeWidth={1}
                      />
                      <circle
                        cx={a.x}
                        cy={a.y}
                        r={3.5}
                        fill="var(--bg)"
                        stroke="var(--ink)"
                        strokeWidth={1.5}
                      />
                    </g>
                  ))}
                  <circle
                    cx={geo.xAt(n - 1)}
                    cy={geo.yAt(last.value)}
                    r={4.5}
                    fill="var(--brand)"
                    stroke="var(--bg)"
                    strokeWidth={2}
                  />
                  {geo.xl.map((x) => (
                    <text
                      key={`${x.label}-${x.anchor}`}
                      x={x.x}
                      y={H - 4}
                      textAnchor={x.anchor}
                      fontSize={11}
                      fill="var(--ink3)"
                    >
                      {x.label}
                    </text>
                  ))}
                  {hv && hover !== null ? (
                    <g pointerEvents="none">
                      <line
                        x1={geo.xAt(hover)}
                        x2={geo.xAt(hover)}
                        y1={PAD_TOP}
                        y2={geo.yAt(hv.value)}
                        stroke="var(--ink3)"
                        strokeWidth={1}
                      />
                      <circle cx={geo.xAt(hover)} cy={geo.yAt(hv.value)} r={4} fill="var(--ink)" />
                    </g>
                  ) : null}
                  <rect
                    x={0}
                    y={0}
                    width={W}
                    height={H}
                    fill="transparent"
                    style={{ touchAction: "pan-y" }}
                    onPointerMove={(e) => {
                      // Hovering mouse, or a finger that's down and scrubbing.
                      if (e.pointerType === "mouse" || e.buttons !== 0) onPointer(e);
                    }}
                    onPointerDown={onPointer}
                    onPointerLeave={(e) => {
                      if (e.pointerType === "mouse") setHover(null);
                    }}
                  />
                </svg>
                {geo.ann.map((a) => (
                  <AnnotationLabel key={a.key} a={a} width={W} />
                ))}
                {hv && hover !== null ? (
                  <div
                    role="status"
                    className="pointer-events-none absolute top-0 z-10 w-[208px] -translate-x-1/2 rounded-xl bg-surface px-3 py-2.5 text-xs leading-[18px] shadow-tip"
                    style={{ left: Math.min(Math.max(geo.xAt(hover), 104), W - 104) }}
                  >
                    <div className="font-semibold">{formatDay(hv.date)}</div>
                    {/* 평가손익 is on the holdings alone — 평가금액 − 예수금 − 매입금액 —
                        the same definition as the hero's 총 평가손익. */}
                    <div className="mt-1 flex justify-between gap-3">
                      <span className="text-ink-3">평가금액</span>
                      <span className="num">{formatWon(hv.value)}</span>
                    </div>
                    {hv.deposit ? (
                      <div className="flex justify-between gap-3">
                        <span className="text-ink-3">− 예수금</span>
                        <span className="num">{formatWon(hv.deposit)}</span>
                      </div>
                    ) : null}
                    <div className="flex justify-between gap-3">
                      <span className="text-ink-3">− 매입금액</span>
                      <span className="num">{formatWon(hv.invested)}</span>
                    </div>
                    <div className="mt-1 flex justify-between gap-3 border-t border-line pt-1">
                      <span className="text-ink-3">평가손익</span>
                      <span className={cn("num font-semibold", marketTone(pointPnl(hv)))}>
                        {formatWon(pointPnl(hv), { sign: true })}
                      </span>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-3 lg:mt-3 lg:gap-x-5">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-0.5 w-3.5 bg-ink lg:w-4" />
              평가금액<span className="hidden lg:inline"> (예수금 포함)</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="w-3.5 border-t-[1.5px] border-dashed border-ink-3 lg:w-4"
              />
              매입금액
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-ink-3" />
              입출금일
            </span>
          </div>
        </>
      )}
    </section>
  );
}
