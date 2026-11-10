"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import dynamic from "next/dynamic";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { AiLine, CountUp, EvidenceScope } from "@/components/ds";
import { shiftDateKey } from "@/lib/date-key";
import { formatCount, formatDurationMinutes, formatTime, formatWon } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useHealthSummary } from "@/modules/health/hooks";
import type { HealthMetricSeries } from "@/modules/health/types";
import {
  useDailyDistances,
  useLocations,
  useStayPoints,
  useTracks,
} from "@/modules/location/hooks";
import { pickDayFact } from "../../day-facts";
import { buildDayModel, dedupeNights, minuteOfDay, routeLabel, sleepForDay } from "../../day-model";
import { useDayCommits, useTransactionsForDate } from "../../hooks";
import { DateNav } from "./DateNav";
import { DayList } from "./DayList";
import { DayStrip } from "./DayStrip";

const DayMap = dynamic(() => import("@/modules/location/components/DayMap").then((m) => m.DayMap), {
  ssr: false,
  loading: () => <div className="size-full animate-pulse bg-sunken" />,
});

const DESKTOP = "(min-width: 1024px)";
function subscribeDesktop(cb: () => void) {
  const mql = window.matchMedia(DESKTOP);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}
function useIsDesktop() {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP).matches,
    () => true
  );
}

interface StatsResponse {
  stats: { date: string; count: number }[];
}

function pointFor(series: HealthMetricSeries[] | undefined, key: string, date: string) {
  const metric = series?.find((m) => m.key === key);
  return { metric, point: metric?.points.find((p) => p.day === date) ?? null };
}

/**
 * One KST day, map first: PC puts the 800×600 map beside a compact scrolling
 * list under a single meta line; phones lead with a full-bleed map carrying the
 * date pill. Every source keeps its existing hook (and polling while today).
 */
export function DayView({
  date,
  today,
  onDateChange,
  initialCenter,
  notice,
}: {
  date: string;
  today: string;
  onDateChange: (date: string) => void;
  initialCenter: { latitude: number; longitude: number } | null;
  /** Optional banner (e.g. first GitHub sync) shown above the list. */
  notice?: ReactNode;
}) {
  const desktop = useIsDesktop();
  const isToday = date === today;

  const stayPointsData = useStayPoints(date).stayPoints;
  const tracksData = useTracks(date).tracks;
  const locationsData = useLocations(date).locations;
  // A malformed or partial response degrades to "no records", never a crash.
  const stayPoints = useMemo(() => stayPointsData ?? [], [stayPointsData]);
  const tracks = useMemo(() => tracksData ?? [], [tracksData]);
  const locations = useMemo(() => locationsData ?? [], [locationsData]);
  const { commits, error: commitsError, refresh: refreshCommits } = useDayCommits(date);
  const { transactions, error: txError, refresh: refreshTx } = useTransactionsForDate(date);
  const { summary } = useHealthSummary();
  const { distances } = useDailyDistances(date, date);
  const { data: stats } = useQuery<StatsResponse>({
    queryKey: ["timeline", "stats"],
    queryFn: async () => {
      const response = await fetch("/api/timeline/stats");
      if (!response.ok) throw new Error(`stats ${response.status}`);
      return response.json();
    },
    staleTime: 5 * 60_000,
  });

  const sessions = summary?.sleepSessions;
  const sleep = useMemo(() => sleepForDay(sessions, date), [sessions, date]);
  const recentSleeps = useMemo(
    () =>
      dedupeNights(sessions ?? []).filter((s) => minuteOfDay(s.start, date) + s.minutes <= 1440),
    [sessions, date]
  );

  const model = useMemo(
    () =>
      buildDayModel({
        date,
        stayPoints,
        tracks,
        locations,
        commits: commits ?? [],
        transactions: transactions ?? [],
        sleep,
        recentSleeps,
        workouts: summary?.workouts ?? [],
      }),
    [
      date,
      stayPoints,
      tracks,
      locations,
      commits,
      transactions,
      sleep,
      recentSleeps,
      summary?.workouts,
    ]
  );

  const priorCommitCounts = useMemo(() => {
    if (!stats?.stats) return null;
    const byDay = new Map(stats.stats.map((s) => [s.date, s.count]));
    const earliest = stats.stats.map((s) => s.date).sort()[0] ?? date;
    const prior = Array.from({ length: 7 }, (_, i) => shiftDateKey(date, -(i + 1)));
    if (prior[6] < earliest) return null;
    return prior.map((d) => byDay.get(d) ?? 0);
  }, [stats, date]);

  const dayFact = useMemo(
    () => pickDayFact({ date, model, recentSleeps, priorCommitCounts, isToday }),
    [date, model, recentSleeps, priorCommitCounts, isToday]
  );

  // ── selection (shared by map, strip and list) ──
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scrollKey, setScrollKey] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear on a new date
  useEffect(() => setSelectedId(null), [date]);
  const selectedMapId = useMemo(() => {
    if (!selectedId) return null;
    return model.rows.find((r) => r.id === selectedId)?.mapId ?? null;
  }, [selectedId, model.rows]);
  const selectFromList = useCallback((id: string) => {
    setSelectedId((cur) => (cur === id ? null : id));
  }, []);
  const selectFromMap = useCallback((id: string | null) => {
    setSelectedId((cur) => (id && cur === id ? null : id));
    if (id) setScrollKey((k) => k + 1);
  }, []);

  const altitudes = useMemo(() => {
    const out: Record<string, number[]> = {};
    for (const r of model.rides) {
      const t0 = new Date(r.startIso).getTime();
      const t1 = new Date(r.endIso).getTime();
      const alt = locations
        .filter((l) => {
          const t = new Date(l.timestamp).getTime();
          return t >= t0 && t <= t1 && l.altitude != null;
        })
        .map((l) => l.altitude as number);
      if (alt.length > 1) out[r.id] = alt;
    }
    return out;
  }, [model.rides, locations]);

  const mapStays = model.stays;
  const mapRides = useMemo(
    () =>
      model.rides.map((r) => ({
        id: r.id,
        startIso: r.startIso,
        endIso: r.endIso,
        label: [r.mode, routeLabel(r.from, r.to)].filter(Boolean).join(" · "),
      })),
    [model.rides]
  );

  // ── meta line ──
  const distanceKm = (distances[date] ?? 0) / 1000;
  const meta: ReactNode[] = [];
  if (model.commitCount > 0)
    meta.push(
      <>
        커밋 <CountUp value={model.commitCount} className="font-medium text-ink" />
      </>
    );
  if (distanceKm >= 0.1)
    meta.push(
      <>
        <CountUp value={distanceKm} decimals={1} className="font-medium text-ink" />
        km
      </>
    );
  if (model.spendTotal > 0)
    meta.push(
      <CountUp
        value={model.spendTotal}
        format={(n) => formatWon(n)}
        className="font-medium text-ink"
      />
    );
  if (model.sleep)
    meta.push(
      <>
        수면{" "}
        <CountUp
          value={model.sleep.asleepMin}
          format={(n) => formatDurationMinutes(n)}
          className="font-medium text-ink"
        />
      </>
    );
  const metaLine =
    meta.length > 0 ? (
      // Each item carries its "·" in a ::before inside its own left padding; the
      // item that starts a line has that dot pushed into the negative margin the
      // overflow-hidden wrapper clips, so a wrap never leads with "·" (DotList pattern).
      <p className="m-0 min-w-0 overflow-hidden text-[13px] leading-5 text-ink-2">
        <span className="sr-only">하루 요약: </span>
        <span className="-ml-[18px] flex flex-wrap">
          {meta.map((m, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: positional meta items
              key={i}
              className="relative whitespace-nowrap pl-[18px] before:absolute before:left-[7px] before:text-ink-3 before:content-['·']"
            >
              {m}
            </span>
          ))}
        </span>
      </p>
    ) : null;

  const aiLine = dayFact ? <AiLine fact={dayFact.fact} rows={dayFact.rows} /> : null;

  const chain =
    model.chain.length > 0 ? (
      <p className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] leading-5 font-semibold text-ink">
        <span className="sr-only">이동 경로: </span>
        {model.chain.map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional chain
          <span key={i} className="inline-flex items-center gap-1.5">
            {i > 0 ? (
              <ArrowRight className="size-3 text-ink-3" strokeWidth={2.2} aria-hidden="true" />
            ) : null}
            <span>
              {c.name}
              {c.duration ? (
                <span className="num ml-1 text-xs font-medium text-ink-2">{c.duration}</span>
              ) : null}
            </span>
          </span>
        ))}
      </p>
    ) : null;

  // ── body (steps, resting heart rate) ──
  const body = useMemo(() => {
    const items: { label: string; value: string; unit: string; note: string }[] = [];
    const steps = pointFor(summary?.metrics, "steps", date);
    const stepValue = steps.point?.sum ?? steps.point?.avg ?? null;
    if (stepValue != null && stepValue > 0) {
      const others = (steps.metric?.points ?? [])
        .filter((p) => p.day !== date && p.day < date)
        .map((p) => p.sum ?? p.avg ?? 0)
        .filter((v) => v > 0);
      const avg = others.length > 0 ? others.reduce((a, b) => a + b, 0) / others.length : null;
      items.push({
        label: "걸음",
        value: formatCount(Math.round(stepValue)),
        unit: "걸음",
        note:
          isToday && summary?.lastSyncedAt
            ? `${formatTime(new Date(summary.lastSyncedAt))} 동기화까지 · 하루가 끝나지 않은 값`
            : avg
              ? `최근 30일 평균 ${formatCount(Math.round(avg))}걸음`
              : "",
      });
    }
    const rhr = pointFor(summary?.metrics, "resting_heart_rate", date);
    const rhrValue = rhr.point?.avg ?? null;
    if (rhrValue != null) {
      const values = (rhr.metric?.points ?? [])
        .map((p) => p.avg)
        .filter((v): v is number => v != null);
      const min = Math.min(...values);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      items.push({
        label: "안정시 심박",
        value: String(Math.round(rhrValue)),
        unit: "bpm",
        note:
          values.length >= 7 && Math.round(rhrValue) <= Math.round(min)
            ? "최근 30일 최저"
            : values.length >= 7
              ? `최근 30일 평균 ${Math.round(avg)}bpm`
              : "",
      });
    }
    return items;
  }, [summary, date, isToday]);

  const bodyRow =
    body.length > 0 ? (
      <div className="grid grid-cols-2 border-t border-line">
        {body.map((b, i) => (
          <div
            key={b.label}
            className={cn("flex flex-col gap-1 pt-3.5 pr-4", i > 0 && "border-l border-line pl-4")}
          >
            <span className="text-label">{b.label}</span>
            <span className="num text-lg leading-6 font-medium text-ink">
              {b.value}
              <small className="ml-[3px] text-xs text-ink-3">{b.unit}</small>
            </span>
            {b.note ? <span className="text-xs leading-[17px] text-ink-2">{b.note}</span> : null}
          </div>
        ))}
      </div>
    ) : null;

  const errors =
    commitsError || txError ? (
      <div role="alert" className="mb-3 flex flex-wrap gap-x-3 text-[13px] leading-5 text-gain">
        {commitsError ? (
          <span>
            {commitsError}{" "}
            <button type="button" className="underline" onClick={refreshCommits}>
              다시 시도
            </button>
          </span>
        ) : null}
        {txError ? (
          <span>
            {txError}{" "}
            <button type="button" className="underline" onClick={refreshTx}>
              다시 시도
            </button>
          </span>
        ) : null}
      </div>
    ) : null;

  const list =
    model.rows.length > 0 ? (
      <DayList
        rows={model.rows}
        selectedId={selectedId}
        selectedMapId={selectedMapId}
        onSelect={selectFromList}
        altitudes={altitudes}
        scrollKey={scrollKey}
        compact={!desktop}
      />
    ) : (
      <p className="m-0 py-2 text-[13px] leading-5 text-ink-3">이날 남은 기록이 없어요.</p>
    );

  const map = (
    <DayMap
      date={date}
      locations={locations}
      stayPoints={stayPoints}
      stays={mapStays}
      rides={mapRides}
      selectedMapId={selectedMapId}
      onSelect={selectFromMap}
      initialCenter={initialCenter}
      padding={desktop ? 56 : 44}
      className={desktop ? "size-full" : "h-[330px] w-full border-b border-line"}
      topLeft={
        desktop ? undefined : (
          <DateNav date={date} today={today} onChange={onDateChange} variant="pill" />
        )
      }
    />
  );

  const strip =
    model.stays.length + model.rides.length > 0 ? (
      <DayStrip
        stays={model.stays}
        rides={model.rides}
        selectedMapId={selectedMapId}
        onSelect={selectFromMap}
        compact={!desktop}
      />
    ) : null;

  if (!desktop) {
    return (
      <EvidenceScope>
        <main id="main" className="pb-10">
          <h1 className="sr-only">타임라인</h1>
          <section className="ds-enter relative">{map}</section>
          <section className="ds-enter px-4 [animation-delay:100ms]">
            {strip ? <div className="mt-2.5">{strip}</div> : null}
            {chain ? <div className="mt-3">{chain}</div> : null}
            {metaLine ? <div className="mt-0.5">{metaLine}</div> : null}
            {aiLine ? <div className="mt-1.5">{aiLine}</div> : null}
          </section>
          <section className="ds-enter mt-4 px-4 [animation-delay:200ms]">
            {notice}
            {errors}
            <div className="timeline-scroll-container">{list}</div>
          </section>
          {bodyRow ? <section className="mt-6 px-4">{bodyRow}</section> : null}
        </main>
      </EvidenceScope>
    );
  }

  return (
    <EvidenceScope>
      <main id="main" className="mx-auto w-full max-w-[1440px] px-page pt-5 pb-12">
        <h1 className="sr-only">타임라인</h1>
        <div className="ds-enter relative z-10 flex min-w-0 items-center gap-3.5">
          <DateNav date={date} today={today} onChange={onDateChange} />
          {metaLine}
        </div>
        {aiLine ? <div className="ds-enter mt-1.5 max-w-[800px]">{aiLine}</div> : null}
        <section className="ds-enter mt-4 grid grid-cols-[minmax(0,800fr)_minmax(0,416fr)] items-start gap-8 [animation-delay:100ms]">
          <div className="flex min-w-0 flex-col">
            <div className="relative aspect-[4/3] overflow-hidden rounded-[14px]">
              {map}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-[7] rounded-[14px] shadow-[inset_0_0_0_1px_var(--line)]"
              />
            </div>
            {chain ? <div className="mt-2.5">{chain}</div> : null}
            {strip ? <div className="mt-3">{strip}</div> : null}
            {bodyRow ? <div className="mt-5">{bodyRow}</div> : null}
          </div>
          <div
            data-day-scroll
            className="timeline-scroll-container -ml-2.5 h-[min(784px,calc(100dvh-150px))] min-h-[480px] overflow-y-auto overscroll-contain pr-2 [scrollbar-width:thin]"
          >
            {notice}
            {errors}
            {list}
          </div>
        </section>
      </main>
    </EvidenceScope>
  );
}
