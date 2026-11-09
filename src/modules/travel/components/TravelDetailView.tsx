"use client";

import Link from "next/link";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { CountUp, EvidenceScope, useEvidence } from "@/components/ds";
import { Button } from "@/components/ui/button";
import {
  formatCount,
  formatDurationMinutes,
  formatShare,
  formatTime,
  formatWon,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { categoryLabel } from "../categories";
import {
  buildItinerary,
  type DenseRun,
  dayHead,
  type HealthRow,
  type HeroDay,
  healthTable,
  type ItineraryDay,
  mapLabels,
  modeLabel,
  pickHeroDay,
  routeByDay,
  routineInsight,
  shortCity,
  shortDay,
  spendingView,
  transportInsight,
  tripWindow,
} from "../detail-model";
import type { TravelRoute, TravelTripDetail } from "../hooks";
import { dayCount, destinationOf, isSpendingRecorded, stayLabel } from "../list-model";
import { REFERENCE_CITIES } from "../reference-cities";
import { isRoutinePlace } from "../routine-places";
import { Chevron, Collapse, enter, Fig, InsightLine, Pill } from "./parts";
import { TripMenu } from "./TripMenu";
import { TripRouteSketch, WalkSketch } from "./TripRouteSketch";

const H3 =
  "m-0 font-serif text-[20px] leading-7 font-semibold tracking-[-0.02em] sm:text-[22px] sm:leading-[30px]";

function kmNumber(meters: number): number {
  return Math.round(meters / 1000);
}

function hm(iso: string): string {
  return formatTime(new Date(iso));
}

function headWhen(iso: string): string {
  const d = new Date(iso);
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
  return `${dayHead(key)} ${formatTime(d)}`;
}

function txWhen(iso: string): string {
  const d = new Date(iso);
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
  return `${Number(key.slice(5, 7))}월 ${Number(key.slice(8))}일 ${formatTime(d)}`;
}

export function buildGpx(name: string, route: TravelRoute): string {
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const pts = [...route.points]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map(
      (p) =>
        `      <trkpt lat="${p.lat}" lon="${p.lon}"><time>${new Date(p.timestamp).toISOString()}</time></trkpt>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Cistory" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

function downloadGpx(name: string, route: TravelRoute) {
  const blob = new Blob([buildGpx(name, route)], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[\\/:*?"<>|]/g, "_")}.gpx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── header ──────────────────────────────────────────────────────────────────

function DetailHeader({
  detail,
  route,
  onRename,
  onNotTrip,
}: {
  detail: TravelTripDetail;
  route: TravelRoute;
  onRename: (name: string) => Promise<boolean>;
  onNotTrip: () => void;
}) {
  const { trip } = detail;
  const window = tripWindow(detail.visits);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(trip.name);
  const [saving, setSaving] = useState(false);
  const cities = [...new Set(trip.visitedCities.map(shortCity))].slice(0, 3);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || name.trim() === trip.name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const ok = await onRename(name);
    setSaving(false);
    if (ok) setEditing(false);
  };

  return (
    <div
      className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-4", enter(0).className)}
      style={enter(0).style}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-label">
          <Link
            href="/travel"
            className="rounded-sm hover:text-ink focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-brand"
          >
            여행
          </Link>
          {cities.length ? ` · ${cities.join(" · ")}` : ""}
          {trip.isOverseas ? " · 해외" : ""}
        </span>
        {editing ? (
          <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
            <label htmlFor="trip-name" className="sr-only">
              여행 이름
            </label>
            <input
              id="trip-name"
              // biome-ignore lint/a11y/noAutofocus: opened by the rename button
              autoFocus
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              className="h-11 min-w-0 rounded-control border-0 bg-surface px-3 font-serif text-2xl font-bold text-ink shadow-[inset_0_0_0_1px_var(--line)] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--brand)]"
            />
            <Button type="submit" disabled={saving}>
              저장
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              취소
            </Button>
          </form>
        ) : (
          <h1 className="m-0 font-serif text-[26px] leading-[34px] font-bold tracking-[-0.02em] sm:text-[32px] sm:leading-10">
            {trip.name}
          </h1>
        )}
        <p className="m-0 text-sm leading-[22px] text-ink-2">
          {window.departAt && window.arriveAt ? (
            <>
              {headWhen(window.departAt).replace(/ (\d\d:\d\d)$/, " ")}
              <span className="num">{hm(window.departAt)}</span>
              {window.departFromHome ? " 집에서 출발" : " 출발"} →{" "}
              {headWhen(window.arriveAt).replace(/ (\d\d:\d\d)$/, " ")}
              <span className="num">{hm(window.arriveAt)}</span>
              {window.arriveHome ? " 도착" : " 마지막 기록"}
              {window.minutes != null ? (
                <>
                  {" · "}
                  <span className="num">{formatDurationMinutes(window.minutes)}</span>
                </>
              ) : null}
            </>
          ) : (
            <>
              {dayHead(trip.startDate)}–{dayHead(trip.endDate)} ·{" "}
              {stayLabel(trip.startDate, trip.endDate)}
            </>
          )}
          {trip.autoDetected ? " · 자동 감지" : " · 직접 추가"}
        </p>
      </div>
      <div className={cn("flex items-center gap-2", editing && "hidden")}>
        <Button variant="outline" onClick={() => setEditing(true)}>
          이름 바꾸기
        </Button>
        <TripMenu
          tripId={trip.id}
          tripName={trip.name}
          onNotTrip={onNotTrip}
          extra={
            route.points.length > 1
              ? [{ label: "경로 GPX로 내보내기", onSelect: () => downloadGpx(trip.name, route) }]
              : undefined
          }
          triggerClassName="size-9 bg-surface shadow-ring hover:bg-surface hover:shadow-ring-hover"
          exclusionRadiusText="10 km"
        />
      </div>
    </div>
  );
}

// ── hero ────────────────────────────────────────────────────────────────────

function HeroDayPanel({ hero, route }: { hero: HeroDay; route: TravelRoute }) {
  const { isActive } = useEvidence();
  const max = Math.max(...hero.series.map((s) => s.steps ?? 0), 1);
  const run = hero.run;
  const walkPoints = run
    ? route.points
        .filter((p) => p.timestamp >= run.startAt && p.timestamp <= run.endAt)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    : [];
  return (
    <div className="grid min-w-0 gap-6 border-line sm:grid-cols-[minmax(0,1fr)_200px] sm:gap-8 lg:col-span-7 lg:border-l lg:pl-8">
      <div className="flex min-w-0 flex-col gap-3">
        <span className="text-label flex items-center gap-1.5">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-health" />
          가장 많이 움직인 날
        </span>
        <h2 className="m-0 font-serif text-[20px] leading-7 font-semibold tracking-[-0.02em] sm:text-[22px] sm:leading-[30px]">
          {dayHead(hero.day)}
          {run ? ` · ${run.label}` : ""}
        </h2>
        <div className="flex flex-wrap gap-x-7 gap-y-2">
          <div className="flex flex-col gap-0.5">
            <Fig value={<CountUp value={hero.steps} />} />
            <span className="text-label">걸음</span>
          </div>
          {hero.activeZoneMinutes != null ? (
            <div className="flex flex-col gap-0.5">
              <Fig value={<CountUp value={hero.activeZoneMinutes} />} unit="분" />
              <span className="text-label">활동 존</span>
            </div>
          ) : null}
          {hero.activeEnergy != null ? (
            <div className="flex flex-col gap-0.5">
              <Fig value={<CountUp value={hero.activeEnergy} />} unit="kcal" />
              <span className="text-label">활동 칼로리</span>
            </div>
          ) : null}
        </div>
        <div role="img" aria-label="날짜별 걸음" className="mt-1 flex items-end gap-2.5">
          {hero.series.map((s, i) => {
            const top = s.day === hero.day;
            return (
              <div key={s.day} className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-[92px]">
                <span className="num text-[11px] text-ink-2">
                  {s.steps == null ? "–" : formatCount(s.steps)}
                </span>
                <span
                  className="ds-grow block rounded-[3px] transition-colors duration-150"
                  style={{
                    height: `${Math.max(2, Math.round(((s.steps ?? 0) / max) * 44))}px`,
                    background: top
                      ? "var(--health)"
                      : isActive
                        ? "var(--track)"
                        : "color-mix(in oklab, var(--ink3) 45%, transparent)",
                    animationDelay: `${i * 20}ms`,
                  }}
                />
                <span className={cn("text-label truncate", top && "text-ink")}>
                  {Number(s.day.slice(5, 7))}월 {Number(s.day.slice(8))}일
                </span>
              </div>
            );
          })}
        </div>
        <InsightLine insight={hero.insight} className="mt-1.5" />
      </div>
      {run && walkPoints.length + run.stops.length >= 2 ? (
        <figure className="m-0 hidden flex-col gap-2 sm:flex">
          <WalkSketch points={walkPoints} stops={run.stops} ariaLabel={`${run.label} 경로`} />
          <figcaption className="text-label">
            {run.label} 경로 · 정류 <span className="num">{run.stops.length}</span>건
          </figcaption>
        </figure>
      ) : null}
    </div>
  );
}

function Hero({
  detail,
  hero,
  route,
}: {
  detail: TravelTripDetail;
  hero: HeroDay | null;
  route: TravelRoute;
}) {
  const { trip, transport, spending } = detail;
  const lodging = detail.visits
    .filter((v) => !isRoutinePlace(v.savedPlaceName, v.savedPlaceCategory) && v.savedPlaceName)
    .sort((a, b) => b.durationSeconds - a.durationSeconds)[0];
  const recorded = isSpendingRecorded(trip, detail.spendingSince);
  return (
    <div
      className={cn(
        "mt-8 grid grid-cols-[minmax(0,1fr)] gap-8 border-b border-line pb-8 lg:grid-cols-12 lg:gap-x-6",
        enter(1).className
      )}
      style={enter(1).style}
    >
      <div
        className={cn("flex min-w-0 flex-col gap-2.5", hero ? "lg:col-span-5" : "lg:col-span-12")}
      >
        <span className="text-label">이동 거리</span>
        {trip.totalDistanceMeters != null ? (
          <span className="num text-[40px] leading-[44px] font-medium tracking-[-0.03em] sm:text-[48px] sm:leading-[52px]">
            <CountUp value={kmNumber(trip.totalDistanceMeters)} />
            <span className="ml-0.5 font-sans text-[20px] font-medium tracking-normal text-ink-3">
              km
            </span>
          </span>
        ) : (
          <span className="text-[15px] text-ink-3">GPS 경로 기록 없음</span>
        )}
        <p className="m-0 text-[13px] leading-5 text-ink-2">
          GPS 경로 전체 합계.
          {transport.totalDistanceMeters > 0 ? (
            <>
              {" "}
              이동 수단으로 분류된 구간은{" "}
              <span className="num text-ink">
                {formatCount(transport.totalDistanceMeters / 1000)}
              </span>{" "}
              km예요(아래 이동 수단).
            </>
          ) : null}
        </p>
        <div className="mt-3.5 flex flex-wrap gap-y-3">
          <div className="flex flex-col gap-0.5 pr-6">
            <Fig
              value={stayLabel(trip.startDate, trip.endDate)}
              className="font-sans tracking-normal"
            />
            <span className="text-label">
              {lodging
                ? `${shortCity(lodging.city ?? destinationOf(trip))} ${lodging.savedPlaceName} 체류`
                : "기간"}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 border-l border-line px-6 max-[359px]:pr-0">
            {recorded ? (
              <Fig value={<CountUp value={spending.total} />} unit="원" />
            ) : (
              <span className="text-[15px] leading-7 text-ink-3">기록 없음</span>
            )}
            <span className="text-label">
              지출{recorded ? ` · ${spending.transactions.length}건` : ""}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 border-l border-line pl-6 max-[359px]:basis-full max-[359px]:border-l-0 max-[359px]:pl-0">
            <Fig value={formatCount(detail.visits.length)} unit="건" />
            <span className="text-label">머문 기록</span>
          </div>
        </div>
      </div>
      {hero ? <HeroDayPanel hero={hero} route={route} /> : null}
    </div>
  );
}

// ── itinerary ───────────────────────────────────────────────────────────────

function RunCard({ run, hero }: { run: DenseRun; hero: HeroDay | null }) {
  const [open, setOpen] = useState(false);
  const { isActive } = useEvidence();
  const id = useId();
  const isHeroRun = hero?.run?.id === run.id;
  return (
    <div
      className="my-1.5 ml-1.5 rounded-xl shadow-[inset_0_0_0_1px_var(--line)] transition-colors duration-150"
      style={{
        background:
          isHeroRun && isActive
            ? "color-mix(in oklab, var(--health) 10%, var(--surface))"
            : "var(--surface)",
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-0 bg-transparent px-3.5 py-3 text-left text-ink focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-baseline gap-x-2.5">
            <span className="text-[15px] leading-[22px] font-semibold">{run.label}</span>
            <span className="num text-xs text-ink-2">
              {hm(run.startAt)}–{hm(run.endAt)} · {formatDurationMinutes(run.minutes)}
            </span>
          </span>
          <span className="flex items-center gap-1.5 text-xs leading-4 text-ink-2">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-health" />
            <span>
              {isHeroRun ? "이 여행에서 가장 길게 걸은 구간 · " : ""}경유{" "}
              <span className="num">{run.stops.length}</span>곳
              {isHeroRun && hero ? ` · ${formatCount(hero.steps)}걸음의 날` : ""}
            </span>
          </span>
        </span>
        <Chevron className="text-ink-2" />
      </button>
      <Collapse open={open} id={id}>
        <ol className="m-0 grid list-none gap-x-5 px-3.5 pt-0.5 pb-3.5 sm:grid-cols-2">
          {run.stops.map((stop) => (
            <li
              key={`${stop.at}-${stop.name}`}
              className="flex gap-2.5 border-t border-line py-1.5 text-xs leading-[18px]"
            >
              <span className="num w-[38px] shrink-0 text-ink-3">{hm(stop.at)}</span>
              <span className="text-ink-2">
                {stop.name}
                {stop.minutes >= 8 ? ` · ${formatDurationMinutes(stop.minutes)}` : ""}
              </span>
            </li>
          ))}
        </ol>
      </Collapse>
    </div>
  );
}

function Rail({ dot = 7, color }: { dot?: number; color: string }) {
  return (
    <span className="relative flex justify-center self-stretch">
      <span aria-hidden="true" className="absolute inset-y-0 w-px bg-line" />
      <span
        aria-hidden="true"
        className="relative mt-4 rounded-full"
        style={{ width: dot, height: dot, background: color, boxShadow: "0 0 0 3px var(--bg)" }}
      />
    </span>
  );
}

function ItineraryList({
  days,
  skipped,
  hero,
}: {
  days: ItineraryDay[];
  skipped: number;
  hero: HeroDay | null;
}) {
  return (
    <section aria-labelledby="trip-plan-h" className="flex max-w-[640px] flex-col">
      <div className="flex items-baseline justify-between pb-2">
        <h2 id="trip-plan-h" className={H3}>
          일정
        </h2>
        {skipped > 0 ? <span className="text-label">집·회사 체류는 생략</span> : null}
      </div>
      {days.length === 0 ? (
        <p className="m-0 pt-4 text-[13px] text-ink-3">이 기간에 머문 기록이 없어요.</p>
      ) : null}
      {days.map((day) => (
        <div key={day.day} className="flex flex-col pt-5">
          <div className="flex items-baseline gap-2.5 border-b border-line pb-2">
            <span className="text-[15px] leading-[22px] font-semibold">{day.head}</span>
            {day.sub ? <span className="text-[13px] text-ink-3">{day.sub}</span> : null}
          </div>
          <ol className="m-0 list-none p-0">
            {day.items.map((item) => (
              <li key={item.key} className="grid grid-cols-[52px_20px_minmax(0,1fr)] items-start">
                <span
                  className={cn(
                    "num pt-[9px] text-[13px] leading-[22px]",
                    item.kind === "anchor" ? "text-ink-3" : "text-ink-2"
                  )}
                >
                  {hm(item.at)}
                </span>
                {item.kind === "run" ? (
                  <>
                    <Rail dot={9} color="var(--health)" />
                    <RunCard run={item.run} hero={hero} />
                  </>
                ) : (
                  <>
                    <Rail color={item.kind === "anchor" ? "var(--ink3)" : "var(--place)"} />
                    <div className="flex flex-col gap-0.5 py-[9px] pl-1.5">
                      <span className="flex flex-wrap items-baseline gap-x-2.5">
                        <span
                          className={cn(
                            "text-sm leading-[22px]",
                            item.kind === "anchor" ? "text-ink-2" : "font-medium text-ink"
                          )}
                        >
                          {item.kind === "anchor" ? item.label : item.name}
                        </span>
                        {item.kind === "stop" && item.minutes > 0 ? (
                          <span className="num text-xs text-ink-3">
                            {formatDurationMinutes(item.minutes)}
                          </span>
                        ) : null}
                      </span>
                      {item.note ? (
                        <span className="text-xs leading-4 text-ink-3">{item.note}</span>
                      ) : null}
                    </div>
                  </>
                )}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

// ── spending ────────────────────────────────────────────────────────────────

function SpendingSection({ detail }: { detail: TravelTripDetail }) {
  const view = spendingView(detail);
  const recorded = isSpendingRecorded(detail.trip, detail.spendingSince);
  return (
    <section aria-labelledby="trip-spend-h" className="flex flex-col gap-3.5">
      <h2 id="trip-spend-h" className={H3}>
        지출
      </h2>
      {!recorded ? (
        <p className="m-0 text-[13px] leading-5 text-ink-2">
          기록 없음 — Toss 거래 기록은{" "}
          {detail.spendingSince ? `${dayHead(detail.spendingSince)}부터` : "아직 하나도"} 있어요. 이
          여행의 지출은 0원이 아니라 알 수 없어요.
        </p>
      ) : detail.spending.transactions.length === 0 ? (
        <p className="m-0 text-[13px] text-ink-2">이 기간에 지출 기록이 없어요.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
            <Fig value={formatCount(view.total)} unit="원" />
            {view.top ? (
              <span className="text-[13px] text-ink-2">
                {view.top.label} <span className="num">{formatCount(view.top.total)}</span>원 + 그
                외 <span className="num">{formatCount(view.rest)}</span>원
              </span>
            ) : null}
          </div>
          {view.top ? (
            <div
              role="img"
              aria-label={`${view.top.label} ${formatShare(view.top.share)}, 그 외 ${formatShare(1 - view.top.share)}`}
              className="flex h-2.5 gap-0.5 overflow-hidden rounded-[5px]"
            >
              <span className="ds-growx bg-ink" style={{ width: `${view.top.share * 100}%` }} />
              <span
                className="ds-growx flex-1 bg-ink-3 opacity-45"
                style={{ animationDelay: "80ms" }}
              />
            </div>
          ) : null}
          <ul className="m-0 flex list-none flex-col p-0">
            {detail.spending.transactions.map((tx) => (
              <li
                key={tx.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-line py-[11px] sm:grid-cols-[92px_minmax(0,1fr)_auto]"
              >
                <span className="num col-span-2 text-xs text-ink-3 sm:col-span-1">
                  {txWhen(tx.transactedAt)}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold">{tx.merchant}</span>
                  <span className="text-xs text-ink-3">
                    {categoryLabel(tx.category)} · {tx.accountName}
                  </span>
                  {view.oneOff?.id === tx.id ? (
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs leading-4 text-ink-2">
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-warn" />이 여행
                      지출의 {formatShare(view.oneOff.share)} · 한 건
                    </span>
                  ) : null}
                </span>
                <span className="num text-sm font-medium">{formatWon(tx.amount)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ── health ──────────────────────────────────────────────────────────────────

/** Label column + one column per day; shared by both health tables so they line up. */
const LABEL_COL_PX = 120;
const DAY_COL_MIN_PX = 76;

function HealthGrid({
  rows,
  days,
  heroDay,
  muted,
  label,
}: {
  rows: HealthRow[];
  days: string[];
  heroDay: string | null;
  muted?: boolean;
  label: string;
}) {
  return (
    <table aria-label={label} className="relative w-full table-fixed border-collapse">
      <colgroup>
        <col style={{ width: LABEL_COL_PX }} />
        {days.map((day) => (
          <col key={day} />
        ))}
      </colgroup>
      <thead className={muted ? "sr-only" : undefined}>
        <tr>
          <th scope="col" className="text-label pb-2 text-left">
            지표
          </th>
          {days.map((day) => (
            <th
              key={day}
              scope="col"
              className={cn(
                "text-label px-3 pb-2 text-right whitespace-nowrap",
                day === heroDay && "font-semibold text-ink"
              )}
            >
              {shortDay(day)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className={cn("border-t border-line", muted && "text-[13px]")}>
            <th
              scope="row"
              className={cn(
                "pr-2 text-left font-medium",
                muted ? "py-[9px] text-ink-2" : "py-[11px] text-sm text-ink"
              )}
            >
              {row.label}{" "}
              {row.unit ? <span className="text-xs font-normal text-ink-3">{row.unit}</span> : null}
            </th>
            {row.cells.map((cell, i) => {
              const hot = days[i] === heroDay;
              return (
                <td
                  // biome-ignore lint/suspicious/noArrayIndexKey: one cell per day
                  key={i}
                  className={cn(
                    "num px-3 text-right whitespace-nowrap",
                    muted ? "py-[9px] text-ink-2" : "py-[11px] text-sm text-ink-2",
                    hot && !muted && "font-semibold text-ink"
                  )}
                >
                  {cell.text}
                  {cell.sub ? (
                    <span className="block text-[11px] leading-4 font-normal text-ink-3">
                      {cell.sub}
                    </span>
                  ) : null}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The hero day as one tinted column behind both tables (and the toggle between). */
function HotColumn({ index, count }: { index: number; count: number }) {
  if (index < 0) return null;
  const col = `((100% - ${LABEL_COL_PX}px) / ${count})`;
  return (
    <span
      aria-hidden="true"
      data-testid="hot-column"
      className="pointer-events-none absolute inset-y-0"
      style={{
        left: `calc(${LABEL_COL_PX}px + ${index} * ${col})`,
        width: `calc(${col})`,
        background: "color-mix(in oklab, var(--health) 9%, transparent)",
      }}
    />
  );
}

/** Horizontal scroller with a fade + arrow cue on whichever side has more to see. */
function ScrollX({
  children,
  label,
  minWidth,
}: {
  children: ReactNode;
  label: string;
  /** Content width below which the region scrolls instead of squeezing. */
  minWidth: number;
}) {
  const ref = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [measure]);
  return (
    <div className="relative -mx-4 sm:mx-0">
      <section
        ref={ref}
        aria-label={label}
        tabIndex={edges.left || edges.right ? 0 : -1}
        onScroll={measure}
        className="overflow-x-auto px-4 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-brand sm:px-0"
      >
        <div className="relative" style={{ minWidth }}>
          {children}
        </div>
      </section>
      {edges.left ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-linear-to-r from-page to-transparent"
        />
      ) : null}
      {edges.right ? (
        <span
          aria-hidden="true"
          data-testid="scroll-cue"
          className="pointer-events-none absolute inset-y-0 right-0 flex w-10 items-start justify-end bg-linear-to-l from-page to-transparent pt-0.5 pr-1 text-ink-3"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M4.5 2.5 8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </span>
      ) : null}
    </div>
  );
}

function HealthSection({ detail, hero }: { detail: TravelTripDetail; hero: HeroDay | null }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const table = healthTable(detail);
  if (table.primary.length === 0 && table.more.length === 0) return null;
  const heroDay = hero?.day ?? null;
  return (
    <section aria-labelledby="trip-health-h" className="flex max-w-[640px] flex-col gap-3.5">
      <h2 id="trip-health-h" className={H3}>
        건강
      </h2>
      <ScrollX label="건강 지표 표" minWidth={LABEL_COL_PX + table.days.length * DAY_COL_MIN_PX}>
        <HotColumn index={heroDay ? table.days.indexOf(heroDay) : -1} count={table.days.length} />
        <HealthGrid rows={table.primary} days={table.days} heroDay={heroDay} label="건강 지표" />
        {table.more.length > 0 ? (
          <>
            <div className="sticky left-0 w-fit pt-3.5">
              <Button
                variant="ghost"
                aria-expanded={open}
                aria-controls={id}
                onClick={() => setOpen((v) => !v)}
                className="-ml-2 px-2 text-[13px]"
              >
                다른 지표 {table.more.length}개 <Chevron size={14} />
              </Button>
            </div>
            <Collapse open={open} id={id}>
              <div className="mt-1.5">
                <HealthGrid
                  rows={table.more}
                  days={table.days}
                  heroDay={heroDay}
                  muted
                  label="다른 건강 지표"
                />
              </div>
            </Collapse>
          </>
        ) : null}
      </ScrollX>
    </section>
  );
}

// ── disclosures ─────────────────────────────────────────────────────────────

function DisclosureRow({
  title,
  summary,
  children,
}: {
  title: string;
  summary: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="border-b border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1.5 border-0 bg-transparent py-4 text-left text-ink transition-colors duration-150 hover:bg-[color-mix(in_oklab,var(--track)_60%,transparent)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-brand lg:grid-cols-[220px_minmax(0,1fr)_auto]"
      >
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="col-start-1 row-start-2 min-w-0 lg:col-start-2 lg:row-start-1">
          {summary}
        </span>
        <Chevron className="col-start-2 row-span-2 row-start-1 text-ink-2 lg:col-start-3 lg:row-span-1" />
      </button>
      <Collapse open={open} id={id}>
        <div className="grid gap-x-6 gap-y-3 pb-5 lg:grid-cols-[220px_minmax(0,560px)]">
          {children}
        </div>
      </Collapse>
    </div>
  );
}

function TransportDisclosure({ detail }: { detail: TravelTripDetail }) {
  const { transport } = detail;
  if (transport.modes.length === 0) return null;
  const max = Math.max(...transport.modes.map((m) => m.distanceMeters), 1);
  return (
    <DisclosureRow
      title="이동 수단"
      summary={
        <span className="flex flex-wrap items-center gap-3">
          <Pill pip="var(--warn)">자동 분류 · 정확도 낮음</Pill>
          <span className="text-[13px] text-ink-2">
            분류된 구간{" "}
            <span className="num">{formatCount(transport.totalDistanceMeters / 1000)}</span> km ·{" "}
            {transport.modes.length}가지
          </span>
        </span>
      }
    >
      <div className="pt-1">
        <InsightLine insight={transportInsight(detail)} />
      </div>
      <ul className="m-0 list-none p-0">
        {transport.modes.map((mode) => (
          <li
            key={mode.mode}
            className="relative grid grid-cols-[minmax(0,1fr)_80px_76px] items-center gap-x-3 px-2.5 py-[7px] text-[13px]"
          >
            <span
              aria-hidden="true"
              className="ds-growx absolute inset-y-0.5 left-0 rounded-md bg-track"
              style={{ width: `${(mode.distanceMeters / max) * 100}%` }}
            />
            <span className="relative">{modeLabel(mode.mode)}</span>
            <span className="num relative text-right">
              {(mode.distanceMeters / 1000).toFixed(1)} km
            </span>
            <span className="num relative text-right text-ink-3">
              {formatDurationMinutes(mode.durationSeconds / 60)}
            </span>
          </li>
        ))}
      </ul>
    </DisclosureRow>
  );
}

function RoutineDisclosure({ detail, hero }: { detail: TravelTripDetail; hero: HeroDay | null }) {
  const insight = routineInsight(detail);
  const { routine } = detail;
  const cmp = routine.comparison;
  const days = dayCount(detail.trip.startDate, detail.trip.endDate);
  if (!cmp && routine.commitCount === 0 && routine.codingSeconds === 0) return null;
  const max = Math.max(routine.commitCount, cmp?.commitCount ?? 0, 1);
  return (
    <DisclosureRow
      title="일상 변화"
      summary={
        insight ? (
          // Inside the disclosure button the fact can't be its own button; the
          // interactive line (with its evidence popover) sits in the panel.
          <span className="ai-voice">
            {insight.pre}
            <span className={cn("ds-fact cursor-[inherit]", /\d/.test(insight.trigger) && "num")}>
              {insight.trigger}
            </span>
            {insight.post}
          </span>
        ) : (
          <span className="text-[13px] text-ink-2">
            여행 중 커밋 <span className="num">{formatCount(routine.commitCount)}</span>개
          </span>
        )
      }
    >
      <div className="flex flex-col gap-2 pt-1.5">
        <span className="text-label">
          여행 {days}일 · 직전 {days}일
        </span>
        <InsightLine insight={insight} />
      </div>
      <dl className="m-0 grid grid-cols-[120px_minmax(0,1fr)] items-center gap-y-2.5 text-[13px] sm:grid-cols-[160px_minmax(0,1fr)]">
        <dt className="text-ink-2">커밋 · 여행 {days}일</dt>
        <dd className="m-0 flex items-center gap-2.5">
          <span
            className="ds-growx h-2 rounded bg-brand"
            style={{ width: `${(routine.commitCount / max) * 100}%`, maxWidth: 300 }}
          />
          <span className="num">{formatCount(routine.commitCount)}</span>
        </dd>
        {cmp ? (
          <>
            <dt className="text-ink-2">커밋 · 직전 {days}일</dt>
            <dd className="m-0 flex items-center gap-2.5">
              <span
                className="ds-growx h-2 rounded bg-ink-3 opacity-50"
                style={{ width: `${(cmp.commitCount / max) * 100}%`, maxWidth: 300 }}
              />
              <span className="num">{formatCount(cmp.commitCount)}</span>
            </dd>
            <dt className="text-ink-2">코딩 시간</dt>
            <dd className="m-0">
              <span className="num">{formatDurationMinutes(routine.codingSeconds / 60)}</span>{" "}
              <span className="text-ink-3">
                · 직전 {formatDurationMinutes(cmp.codingSeconds / 60)}
              </span>
            </dd>
          </>
        ) : null}
        {hero ? (
          <>
            <dt className="text-ink-2">걸음 · {shortDay(hero.day)}</dt>
            <dd className="m-0">
              <span className="num">{formatCount(hero.steps)}</span>{" "}
              <span className="text-ink-3">· 다른 날 평균 {formatCount(hero.othersAverage)}</span>
            </dd>
          </>
        ) : null}
      </dl>
    </DisclosureRow>
  );
}

// ── page body ───────────────────────────────────────────────────────────────

export function TravelDetailView({
  detail,
  route,
  onRename,
  onNotTrip,
}: {
  detail: TravelTripDetail;
  route: TravelRoute;
  onRename: (name: string) => Promise<boolean>;
  onNotTrip: () => void;
}) {
  const itinerary = buildItinerary(detail);
  const hero = pickHeroDay(detail, itinerary.runs);
  const routeDays = routeByDay(route.points, detail.trip.startDate, detail.trip.endDate);
  const labels = mapLabels(detail);
  const run = hero?.run;
  const highlight =
    run && hero
      ? {
          lat: run.stops.reduce((s, p) => s + p.lat, 0) / run.stops.length,
          lon: run.stops.reduce((s, p) => s + p.lon, 0) / run.stops.length,
          title: run.label,
          sub: `${formatDurationMinutes(run.minutes)} · ${formatCount(hero.steps)}걸음`,
        }
      : null;
  const out = routeDays.find((d) => d.role === "out");
  const back = routeDays.find((d) => d.role === "back");
  const middle = routeDays.filter((d) => d.role === "middle");

  return (
    <EvidenceScope>
      <DetailHeader detail={detail} route={route} onRename={onRename} onNotTrip={onNotTrip} />
      <Hero detail={detail} hero={hero} route={route} />
      <div
        className={cn(
          "mt-10 grid items-start gap-14 lg:grid-cols-12 lg:gap-x-6",
          enter(2).className
        )}
        style={enter(2).style}
      >
        <div className="flex min-w-0 flex-col gap-14 lg:col-span-5">
          <figure className="m-0 flex flex-col gap-2.5">
            <TripRouteSketch
              days={routeDays}
              labels={labels}
              references={REFERENCE_CITIES}
              highlight={highlight}
              ariaLabel={`여행 경로 지도: ${detail.trip.name}`}
            />
            <figcaption className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2">
              {out ? (
                <span className="inline-flex items-center gap-1.5">
                  <svg aria-hidden="true" width="18" height="4">
                    <line x1="0" y1="2" x2="18" y2="2" stroke="var(--place)" strokeWidth="2.5" />
                  </svg>
                  가는 길 {dayHead(out.day).replace(/ \(.\)$/, "")}
                </span>
              ) : null}
              {back ? (
                <span className="inline-flex items-center gap-1.5">
                  <svg aria-hidden="true" width="18" height="4">
                    <line
                      x1="0"
                      y1="2"
                      x2="18"
                      y2="2"
                      stroke="var(--ink2)"
                      strokeWidth="2"
                      strokeDasharray="5 4"
                    />
                  </svg>
                  오는 길 {dayHead(back.day).replace(/ \(.\)$/, "")}
                </span>
              ) : null}
              {middle.length > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <svg aria-hidden="true" width="18" height="4">
                    <line x1="0" y1="2" x2="18" y2="2" stroke="var(--health)" strokeWidth="2" />
                  </svg>
                  {middle.length === 1
                    ? dayHead(middle[0].day).replace(/ \(.\)$/, "")
                    : `${dayHead(middle[0].day).replace(/ \(.\)$/, "")}–${Number(middle.at(-1)?.day.slice(8))}일`}
                </span>
              ) : null}
            </figcaption>
          </figure>
          <div className="hidden lg:block">
            <SpendingSection detail={detail} />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-14 lg:col-span-7 lg:pl-6">
          <ItineraryList days={itinerary.days} skipped={itinerary.skippedRoutine} hero={hero} />
          <div className="lg:hidden">
            <SpendingSection detail={detail} />
          </div>
          <HealthSection detail={detail} hero={hero} />
        </div>
      </div>
      <div className={cn("mt-12 border-t border-line", enter(3).className)} style={enter(3).style}>
        <TransportDisclosure detail={detail} />
        <RoutineDisclosure detail={detail} hero={hero} />
      </div>
    </EvidenceScope>
  );
}
