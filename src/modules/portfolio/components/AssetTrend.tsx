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
import { chartFact, evidenceKey } from "../facts";
import {
  type AssetPoint,
  type Cashflow,
  cashflowsInRange,
  niceScale,
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
  x: number;
  y: number;
  above: boolean;
  /** Top of the label box (px). */
  top: number;
  text: string;
  align: "start" | "middle" | "end";
}

const ANN_H = 18;
const annWidth = (text: string) => text.length * 7.2;
function annLeft(a: Pick<Annotation, "x" | "align" | "text">): number {
  const w = annWidth(a.text);
  return a.align === "start" ? a.x : a.align === "middle" ? a.x - w / 2 : a.x - w;
}
function overlaps(
  a: { x0: number; x1: number; y0: number; y1: number },
  b: { x0: number; x1: number; y0: number; y1: number }
): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/**
 * A chart callout, anchored by its alignment but measured after layout and
 * shifted to stay inside the chart (estimated widths undershoot the mono digits
 * on narrow screens, which pushed "저점 …" past the left edge).
 */
function AnnotationLabel({ a, width }: { a: Annotation; width: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [left, setLeft] = useState<number | null>(null);
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 0;
    const want = a.align === "start" ? a.x : a.align === "end" ? a.x - w : a.x - w / 2;
    setLeft(Math.max(0, Math.min(width - w, want)));
  }, [a.x, a.align, a.text, width]);
  return (
    <span
      ref={ref}
      className="num pointer-events-none absolute bg-page px-1 py-px text-xs leading-4 whitespace-nowrap text-ink"
      style={{ left: left ?? a.x, top: a.top, visibility: left === null ? "hidden" : undefined }}
    >
      {a.text}
    </span>
  );
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

    const ann: Annotation[] = [];
    const place = (j: number, above: boolean, text: string, key: string) => {
      const x = xAt(j);
      const y = yAt(pts[j].value);
      const align = x < 140 ? "start" : x > W - 140 ? "end" : "middle";
      let top = above ? y - 34 : y + 14;
      if (!above) {
        // Keep the label off the dashed cost line: drop it below the line when
        // the line runs through the box, or lift it above the point if there's
        // no room down there.
        const x0 = annLeft({ x, align, text });
        const x1 = x0 + annWidth(text);
        let invY = Number.NEGATIVE_INFINITY;
        for (let q = 0; q < n; q++) {
          const qx = xAt(q);
          if (qx >= x0 - 4 && qx <= x1 + 4) invY = Math.max(invY, yAt(pts[q].invested));
        }
        if (invY > top - 6 && invY < top + ANN_H + 6) {
          top = invY + 8;
          if (top + ANN_H > base - 2) top = y - 34;
        }
      }
      ann.push({ key, x, y, above, top, text, align });
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
      const x0 = annLeft(a);
      const label = { x0, x1: x0 + annWidth(a.text), y0: a.top, y1: a.top + ANN_H };
      // The tick from the callout down/up to its point.
      const tick = {
        x0: a.x - 3,
        x1: a.x + 3,
        y0: Math.min(a.y, a.top + ANN_H),
        y1: Math.max(a.y, a.top),
      };
      return [label, tick];
    });
    // The dashed cost line where it crosses the axis-label column (x < 90).
    const invNearAxis: number[] = [];
    for (let q = 0; q < n && xAt(q) < 90; q++) invNearAxis.push(yAt(pts[q].invested));
    const crossesCost = (y0: number, y1: number) =>
      invNearAxis.some((iy) => iy > y0 - 2 && iy < y1 + 2);

    const grid: Array<{ y: number; label: string; labelY: number; show: boolean }> = [];
    for (let v = scale.min; v <= scale.max + 1; v += scale.step) {
      const y = yAt(v);
      const label = formatWonCompact(v);
      const box = (ly: number) => ({ x0: 0, x1: label.length * 7 + 4, y0: ly - 11, y1: ly + 2 });
      // Above the grid line by default; below it when the cost line strikes it.
      let labelY = y - 6;
      if (crossesCost(labelY - 11, labelY + 2)) labelY = y + 14;
      const show =
        !crossesCost(labelY - 11, labelY + 2) &&
        labelY + 2 < base &&
        !annBoxes.some((b) => overlaps(b, box(labelY)));
      grid.push({ y, label, labelY, show });
    }

    // "매입금액" sits under the cost line's right end, or above it if a callout is there.
    const invEnd = yAt(pts[n - 1].invested);
    const invLabelBox = (ly: number) => ({ x0: W - 52, x1: W, y0: ly - 12, y1: ly + 2 });
    let invLabelY = invEnd + 16;
    if (annBoxes.some((b) => overlaps(b, invLabelBox(invLabelY))) || invLabelY > base - 2) {
      invLabelY = invEnd - 6;
    }
    const invLabelShow = !annBoxes.some((b) => overlaps(b, invLabelBox(invLabelY)));

    const ticks = desktop ? 6 : 3;
    const xl = Array.from({ length: Math.min(ticks, n) }, (_, t) => {
      const count = Math.min(ticks, n);
      const j = count === 1 ? 0 : Math.round((t * (n - 1)) / (count - 1));
      return {
        x: xAt(j),
        label: formatMonthDay(pts[j].date),
        anchor: t === 0 ? "start" : t === count - 1 ? "end" : "middle",
      } as const;
    });

    const markers = cfs.map((c) => {
      let j = 0;
      for (let q = 0; q < n; q++) if (pts[q].date <= c.date) j = q;
      return { key: `${c.date}-${c.amount}`, x: xAt(j) };
    });

    return { xAt, yAt, line, inv, area, ann, grid, xl, markers, base, invLabelY, invLabelShow };
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
              <AiLine fact={fact} rows={fact.rows} />
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
                    <g key={g.y}>
                      <line x1={0} x2={W} y1={g.y} y2={g.y} stroke="var(--line)" strokeWidth={1} />
                      {g.show ? (
                        <text
                          x={0}
                          y={g.labelY}
                          fontSize={11}
                          fill="var(--ink3)"
                          fontFamily="var(--font-mono)"
                        >
                          {g.label}
                        </text>
                      ) : null}
                    </g>
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
                        x2={a.x}
                        y1={a.above || a.top < a.y ? a.top + ANN_H : a.y + 4}
                        y2={a.above || a.top < a.y ? a.y - 4 : a.top}
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
                    className="pointer-events-none absolute top-0 z-10 w-[200px] -translate-x-1/2 rounded-xl bg-surface px-3 py-2.5 text-xs leading-[18px] shadow-tip"
                    style={{ left: Math.min(Math.max(geo.xAt(hover), 104), W - 104) }}
                  >
                    <div className="font-semibold">{formatDay(hv.date)}</div>
                    <div className="mt-1 flex justify-between">
                      <span className="text-ink-3">평가금액</span>
                      <span className="num">{formatWon(hv.value)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-3">매입금액</span>
                      <span className="num">{formatWon(hv.invested)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-3">평가손익</span>
                      <span className={cn("num", marketTone(hv.value - hv.invested))}>
                        {formatWon(hv.value - hv.invested, { sign: true })}
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
