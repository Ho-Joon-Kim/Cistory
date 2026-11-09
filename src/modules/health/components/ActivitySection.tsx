"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AiLine, EvidenceScope, Segmented, useEvidence } from "@/components/ds";
import { evidenceMatches } from "@/lib/facts/evidence";
import { formatDay, formatMonthDay, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { stepsVisitsFact } from "../health-facts";
import type { ActivityCorrelationDay, HealthMetricSeries } from "../types";
import {
  ACTIVITY_METRICS,
  type ActivityMetricView,
  type ActivityWindow,
  activityMetric,
  fmtNum,
  mean,
  median,
  withUnit,
} from "../view-model";

type Range = "7" | "30";

const pct = (n: number) => `${n}%`;

function MetricTab({
  m,
  win,
  range,
  on,
  onPick,
  onKeyDown,
}: {
  m: ActivityMetricView;
  win: ActivityWindow;
  range: Range;
  on: boolean;
  onPick: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  // The sparkline follows the selected range (last 7 days or the full 30).
  const start = range === "7" ? Math.max(0, win.days.length - 7) : 0;
  const spark = m.values.slice(start);
  const present = spark.filter((v): v is number => v != null);
  const max = present.length > 0 ? Math.max(...present) : 1;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      tabIndex={on ? 0 : -1}
      onClick={onPick}
      onKeyDown={onKeyDown}
      className={cn(
        "flex w-[140px] min-w-0 flex-none cursor-pointer flex-col gap-1.5 rounded-[10px] border-0 p-3 text-left transition-[background-color,scale] duration-150 ease-out active:scale-[.98] focus-visible:outline-2 focus-visible:outline-brand lg:w-auto lg:px-4 lg:pt-3.5 lg:pb-3",
        on ? "bg-brand-soft" : "bg-transparent hover:bg-track"
      )}
    >
      <span className="text-label">{m.label}</span>
      <span>
        <span className="num text-xl leading-[26px] font-medium text-ink lg:text-[22px] lg:leading-7">
          {m.latest != null ? fmtNum(m.latest, m.decimals) : "—"}
        </span>
        <span className="text-xs font-medium text-ink-3 lg:text-[13px]"> {m.unit}</span>
      </span>
      <span className="text-[11px] leading-[14px] whitespace-nowrap text-ink-3 lg:text-xs lg:leading-4">
        {win.fullDay === win.days[win.days.length - 2] ? "어제" : formatMonthDay(win.fullDay)} ·
        중앙값 <span className="num">{m.median != null ? fmtNum(m.median, m.decimals) : "—"}</span>
      </span>
      <span aria-hidden="true" className="hidden h-[22px] items-end gap-px lg:flex">
        {spark.map((v, j) => {
          const i = start + j;
          const partial = win.days[i] === win.partialDay;
          return (
            <span
              key={win.days[i]}
              className="min-h-0 flex-1 rounded-[1px]"
              style={{
                height: v == null ? 0 : pct(Math.max(4, (v / max) * 100)),
                background: partial ? "transparent" : on ? "var(--ink3)" : "var(--bar)",
                boxShadow: partial ? "inset 0 0 0 1px var(--ink3)" : undefined,
              }}
            />
          );
        })}
      </span>
    </button>
  );
}

interface Annotation {
  key: string;
  left: number;
  top: number;
  text: string;
  right: boolean;
  low: boolean;
}

function Bars({
  m,
  win,
  range,
  annotations,
  lastSyncedAt,
  height,
  compact,
}: {
  m: ActivityMetricView;
  win: ActivityWindow;
  range: Range;
  annotations: Annotation[];
  lastSyncedAt: string | null;
  height: number;
  compact?: boolean;
}) {
  const { active } = useEvidence();
  const [hover, setHover] = useState<number | null>(null);
  // Bars grow in once on entrance; the class is dropped afterwards so a bar that
  // starts off-screen (whose animation the browser may never tick) still paints.
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGrown(true), 1600);
    return () => clearTimeout(t);
  }, []);
  const start = range === "7" ? win.days.length - 7 : 0;
  const idx = win.days.slice(start).map((_, j) => start + j);
  const vis = idx.map((i) => m.values[i]).filter((v): v is number => v != null);
  const ymax = Math.max(1, ...vis, m.median ?? 0) * 1.18;
  const bw = 100 / idx.length;
  const today = win.days[win.days.length - 1];

  const tip =
    hover != null
      ? (() => {
          const j = hover - start;
          const v = m.values[hover];
          const cx = j * bw + bw / 2;
          const right = cx > 70;
          const partial = win.days[hover] === win.partialDay;
          return {
            left: right ? cx - bw / 2 : cx + bw / 2,
            right,
            date: formatDay(win.days[hover]),
            empty: v == null,
            val: v == null ? "기록 없음" : withUnit(fmtNum(v, m.decimals), m.unit),
            note:
              partial && v != null && lastSyncedAt
                ? `${formatTime(new Date(lastSyncedAt))} 동기화까지 집계`
                : win.days[hover] > win.partialDay
                  ? "아직 동기화 전"
                  : "",
          };
        })()
      : null;

  const xl: { left: number; text: string; key: string; narrowHide: boolean }[] = [];
  idx.forEach((i, j) => {
    const left = j * bw + bw / 2;
    if (range === "7") {
      if (!compact || j % 2 === 0 || win.days[i] === today)
        xl.push({
          key: win.days[i],
          left,
          text: compact ? `${Number(win.days[i].slice(8))}일` : formatDay(win.days[i]),
          narrowHide: false,
        });
    } else if ((win.days.length - 1 - i) % 7 === 0) {
      // Below ~360px five "10월 13일" labels crowd; keep every other week.
      const week = (win.days.length - 1 - i) / 7;
      xl.push({
        key: win.days[i],
        left,
        text: formatMonthDay(win.days[i]),
        narrowHide: Boolean(compact) && week % 2 === 1,
      });
    }
  });

  return (
    <>
      <div
        className="relative"
        style={{ height }}
        role="img"
        aria-label={`${m.label} 일별 막대`}
        onMouseLeave={() => setHover(null)}
      >
        {m.median != null ? (
          <span
            aria-hidden="true"
            className="absolute inset-x-0 z-[1] border-t border-dashed border-bar"
            style={{ top: pct((1 - m.median / ymax) * 100) }}
          />
        ) : null}
        {idx.map((i, j) => {
          const v = m.values[i];
          const day = win.days[i];
          const partial = day === win.partialDay;
          const on = active ? evidenceMatches(active, day) : null;
          return (
            <span
              key={`${range}-${day}`}
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute bottom-0 flex h-full items-end",
                !grown && "ds-grow"
              )}
              style={
                {
                  left: pct(j * bw + bw * 0.18),
                  width: pct(bw * 0.64),
                  animationDelay: `${j * 20}ms`,
                } as CSSProperties
              }
            >
              <span
                className={cn(
                  "w-full transition-[background-color,opacity] duration-150",
                  compact ? "rounded-[2px_2px_1px_1px]" : "rounded-[3px_3px_1px_1px]"
                )}
                style={{
                  height: v == null ? 3 : pct(Math.max(1.5, (v / ymax) * 100)),
                  background:
                    v == null
                      ? "var(--line)"
                      : partial
                        ? "repeating-linear-gradient(135deg, transparent 0 3px, color-mix(in oklab, var(--ink3) 35%, transparent) 3px 4px)"
                        : on
                          ? "var(--brand)"
                          : hover === i
                            ? "var(--ink)"
                            : "var(--ink3)",
                  boxShadow: partial && v != null ? "inset 0 0 0 1.5px var(--ink3)" : undefined,
                  opacity: on === false ? 0.3 : 1,
                }}
              />
            </span>
          );
        })}
        {tip
          ? null
          : annotations.map((a) => (
              <span
                key={a.key}
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute",
                  a.low ? "top-full" : "-translate-y-full pb-1.5",
                  a.right && (a.low ? "-translate-x-full" : "-translate-x-full")
                )}
                style={{ left: pct(a.left), top: a.low ? undefined : pct(a.top) }}
              >
                <span
                  className={cn(
                    "absolute border-ink-3",
                    a.right ? "right-0 border-r" : "left-0 border-l",
                    a.low ? "top-0 h-[30px] border-dashed" : "bottom-0 h-6"
                  )}
                />
                <span
                  className={cn(
                    "block text-xs leading-4 whitespace-nowrap text-ink-2",
                    a.low
                      ? a.right
                        ? "pt-[30px] pr-1.5"
                        : "pt-[30px] pl-1.5"
                      : cn("bg-page pb-[22px]", a.right ? "pr-1.5" : "pl-1.5")
                  )}
                >
                  {a.text}
                </span>
              </span>
            ))}
        {idx.map((i, j) => (
          <span
            key={`hit-${win.days[i]}`}
            className="absolute inset-y-0"
            style={{ left: pct(j * bw), width: pct(bw) }}
            onMouseEnter={() => setHover(i)}
            onClick={() => setHover(i)}
            aria-hidden="true"
          />
        ))}
        {tip ? (
          <span
            className={cn(
              "pointer-events-none absolute top-0 z-10 flex flex-col gap-0.5 rounded-[10px] bg-surface px-2.5 py-2 whitespace-nowrap shadow-pop",
              tip.right ? "-translate-x-[calc(100%+6px)]" : "translate-x-1.5"
            )}
            style={{ left: pct(tip.left) }}
          >
            <span className="text-xs text-ink-3">{tip.date}</span>
            <span className={cn("text-sm font-semibold text-ink", !tip.empty && "num")}>
              {tip.val}
            </span>
            {tip.note ? <span className="text-xs text-ink-3">{tip.note}</span> : null}
          </span>
        ) : null}
      </div>
      <div className="relative mt-2 h-4 border-t border-line">
        {xl.map((x) => (
          <span
            key={x.key}
            className={cn(
              // bg-page masks an annotation leader that drops through this row.
              "absolute top-1.5 bg-page px-0.5 text-[11px] leading-[14px] whitespace-nowrap text-ink-3",
              x.left > 96 ? "" : "-translate-x-1/2",
              x.narrowHide && "max-[359px]:hidden"
            )}
            style={x.left > 96 ? { right: 0 } : { left: pct(x.left) }}
          >
            {x.text}
          </span>
        ))}
      </div>
    </>
  );
}

export function ActivitySection({
  metrics,
  win,
  correlation,
  lastSyncedAt,
  style,
  className,
}: {
  metrics: HealthMetricSeries[];
  win: ActivityWindow;
  correlation: ActivityCorrelationDay[] | null;
  lastSyncedAt: string | null;
  style?: CSSProperties;
  className?: string;
}) {
  const [range, setRange] = useState<Range>("30");
  const [key, setKey] = useState("steps");
  const tablistRef = useRef<HTMLDivElement>(null);
  const views = useMemo(() => {
    const byKey = new Map(metrics.map((m) => [m.key, m]));
    return ACTIVITY_METRICS.map((def) => activityMetric(def, byKey.get(def.key), win));
  }, [metrics, win]);
  const m = views.find((v) => v.key === key) ?? views[0];
  const today = win.days[win.days.length - 1];
  const fact = key === "steps" ? stepsVisitsFact(correlation, today) : null;
  const hrSeries = metrics.find((s) => s.key === "heart_rate");

  const fullLabel =
    win.fullDay === win.days[win.days.length - 2] ? "어제" : formatMonthDay(win.fullDay);
  const unit = (v: number) => withUnit(fmtNum(v, m.decimals), m.unit);
  let headLead = "";
  let headEm = "";
  let headTail = "";
  if (range === "30") {
    if (m.latest != null) {
      headLead = `${fullLabel} `;
      headEm = unit(m.latest);
      if (m.median != null) {
        const d = m.latest - m.median;
        headTail = ` · 30일 중앙값 ${unit(m.median)}보다 ${unit(Math.abs(d))} ${d >= 0 ? "많음" : "적음"}`;
      }
    } else {
      headLead = `${fullLabel} 기록 없음`;
    }
  } else {
    const start = win.days.length - 7;
    const v7 = m.values
      .slice(start)
      .filter((v, j): v is number => v != null && win.days[start + j] < win.partialDay);
    const a7 = mean(v7);
    if (a7 != null) {
      headLead = "최근 7일 하루 평균 ";
      headEm = unit(a7);
      if (m.median != null) {
        const d = a7 - m.median;
        headTail = ` · 30일 중앙값보다 ${unit(Math.abs(d))} ${d >= 0 ? "많음" : "적음"} (오늘 제외 ${v7.length}일)`;
      }
    } else headLead = "최근 7일 기록 없음";
  }

  // Chart annotations: the peak of the visible range (with context for steps),
  // plus a low-wear day for steps (heart-rate samples < 10% of the usual).
  const annotations: Annotation[] = [];
  {
    const start = range === "7" ? win.days.length - 7 : 0;
    const n = win.days.length - start;
    const bw = 100 / n;
    const vis = m.values
      .map((v, i) => ({ v, i }))
      .filter(({ v, i }) => i >= start && v != null && win.days[i] < win.partialDay) as {
      v: number;
      i: number;
    }[];
    const visMax =
      Math.max(1, ...m.values.slice(start).filter((v): v is number => v != null), m.median ?? 0) *
      1.18;
    if (vis.length > 0) {
      const peak = vis.reduce((a, b) => (b.v > a.v ? b : a));
      const day = win.days[peak.i];
      let text = `${formatMonthDay(day)} · ${unit(peak.v)}`;
      if (key === "steps") {
        const visit = correlation?.find((c) => c.day === day);
        const ex = views.find((v) => v.key === "exercise")?.values[peak.i];
        if (visit && visit.visits > 0)
          text = `${formatMonthDay(day)} · 장소 ${visit.visits}곳 들름`;
        else if (ex != null && ex > 0) text = `${formatMonthDay(day)} · 운동 ${fmtNum(ex)}분`;
      }
      const j = peak.i - start;
      annotations.push({
        key: "peak",
        left: j * bw + bw / 2,
        top: (1 - peak.v / visMax) * 100,
        text,
        right: j / n > 0.6,
        low: false,
      });
    }
    if (key === "steps" && hrSeries) {
      const counts = new Map(hrSeries.points.map((p) => [p.day, p.count ?? 0]));
      const usual = median([...counts.values()].filter((c) => c > 0));
      const low = usual
        ? vis.find(({ i }) => {
            const c = counts.get(win.days[i]);
            return c != null && c > 0 && c < usual * 0.1;
          })
        : undefined;
      if (low) {
        const j = low.i - start;
        annotations.push({
          key: "wear",
          left: j * bw + bw / 2,
          top: 100,
          text: `${formatMonthDay(win.days[low.i])} · 기기 착용 짧음 (심박 ${fmtNum(counts.get(win.days[low.i]) ?? 0)}회)`,
          right: j / n > 0.6,
          low: true,
        });
      }
    }
  }

  // Roving tabindex: arrows/Home/End move selection between the metric tabs.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = views.findIndex((v) => v.key === m.key);
    let next = i;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % views.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (i - 1 + views.length) % views.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = views.length - 1;
    else return;
    e.preventDefault();
    setKey(views[next].key);
    const btn = tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next];
    btn?.focus();
    btn?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const medianLegend = (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      <span aria-hidden="true" className="w-4 border-t border-dashed border-ink-3" />
      중앙값
    </span>
  );

  return (
    <EvidenceScope>
      <section aria-labelledby="h-act" className={className} style={style}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2
            id="h-act"
            className="m-0 font-serif text-xl leading-7 font-semibold tracking-[-0.02em] text-ink lg:text-[22px] lg:leading-[30px]"
          >
            최근 {range}일 활동
          </h2>
          <Segmented
            ariaLabel="기간"
            value={range}
            onChange={setRange}
            items={[
              { value: "7", label: "7일", ariaLabel: "최근 7일" },
              { value: "30", label: "30일", ariaLabel: "최근 30일" },
            ]}
            className="sm:w-[134px]"
          />
        </div>

        <div
          ref={tablistRef}
          role="tablist"
          aria-label="지표"
          className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:mt-5 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden"
        >
          {views.map((v) => (
            <MetricTab
              key={v.key}
              m={v}
              win={win}
              range={range}
              on={v.key === m.key}
              onPick={() => setKey(v.key)}
              onKeyDown={onTabKey}
            />
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-1 lg:mt-7">
          <p className="m-0 text-[15px] leading-[22px] font-semibold text-ink">{m.label}</p>
          <p className="m-0 text-sm leading-[22px] text-ink">
            {headLead}
            {headEm ? <span className="num font-semibold">{headEm}</span> : null}
            <span className="text-ink-2">{headTail}</span>
            {m.median != null ? (
              <span className="ml-2 hidden lg:inline-flex">{medianLegend}</span>
            ) : null}
          </p>
          <div className="max-w-[720px]">
            <AiLine fact={fact} rows={fact?.rows} title="걸음 × 장소 해석" tint />
          </div>
        </div>

        <div className="mt-10 lg:hidden">
          <Bars
            m={m}
            win={win}
            range={range}
            annotations={annotations}
            lastSyncedAt={lastSyncedAt}
            height={180}
            compact
          />
          {m.median != null ? (
            <p className="m-0 mt-10 flex items-center gap-1.5 text-xs leading-4 text-ink-3">
              <span aria-hidden="true" className="w-4 border-t border-dashed border-ink-3" />
              30일 중앙값 <span className="num">{unit(m.median)}</span>
            </p>
          ) : null}
        </div>
        <div className="mt-5 hidden lg:block">
          <Bars
            m={m}
            win={win}
            range={range}
            annotations={annotations}
            lastSyncedAt={lastSyncedAt}
            height={260}
          />
        </div>
      </section>
    </EvidenceScope>
  );
}
