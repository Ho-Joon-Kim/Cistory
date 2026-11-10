"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
  CountUp,
  Disclosure,
  EmptyState,
  ErrorState,
  EvidenceScope,
  LoadingState,
  useEvidence,
} from "@/components/ds";
import { Button } from "@/components/ui/button";
import { isQuantityText } from "@/lib/facts/face";
import { formatCount, formatWon } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NOT_TRIP_UNDO_MS, type TravelListSummary, type TravelTripListItem } from "../hooks";
import {
  byYear,
  cityLine,
  destinationOf,
  formatKm,
  groupLabel,
  groupRecurring,
  type Highlight,
  isSpendingRecorded,
  pickHighlights,
  type RecurringGroup,
  rangeLabel,
  rangeWithWeekdays,
  stayLabel,
  summarizeYear,
  weekdayRange,
  yearRecurringFact,
} from "../list-model";
import { Chevron, enter, Fig, InsightLine, Pill } from "./parts";
import { TripMenu } from "./TripMenu";
import { YearRibbon } from "./YearRibbon";

/** Mono for a pure quantity ("2박 3일"); words ("당일") stay in the sans face. */
const faceOf = (text: string) => (isQuantityText(text) ? "num" : "tabular-nums");

export interface TravelListViewProps {
  trips: TravelTripListItem[];
  summary: TravelListSummary | null;
  today: string;
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
  scheduleNotTrip: (trip: TravelTripListItem) => void;
  undoNotTrip: (tripId: string) => void;
  renameTrip: (tripId: string, name: string) => Promise<boolean>;
}

const COLS =
  "lg:grid lg:grid-cols-[200px_minmax(0,1fr)_96px_96px_72px_140px_40px] lg:gap-x-4 lg:items-center";

function monthDay(key: string): string {
  return `${Number(key.slice(5, 7))}월 ${Number(key.slice(8))}일`;
}

function yearMonth(key: string): string {
  return `${key.slice(0, 4)}년 ${Number(key.slice(5, 7))}월`;
}

// ── hero ────────────────────────────────────────────────────────────────────

function Divider() {
  return <span aria-hidden="true" className="hidden h-7 w-px self-center bg-line sm:block" />;
}

function YearHero({
  summary,
  groups,
  today,
}: {
  summary: TravelListSummary;
  groups: RecurringGroup[];
  today: string;
}) {
  const y = summarizeYear(summary, today);
  const fact = yearRecurringFact(summary, groups, today);
  const share = y.elapsedDays > 0 ? y.days / y.elapsedDays : 0;
  return (
    <section
      aria-label={`${y.year}년 요약`}
      className={cn("mt-8 flex flex-col gap-4 lg:mt-12", enter(1).className)}
      style={enter(1).style}
    >
      <span className="text-label">
        {y.year}년 · {monthDay(today)}까지
      </span>
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-3 sm:gap-x-7">
        <span className="num text-[40px] leading-[44px] font-medium tracking-[-0.03em]! text-ink sm:text-[48px] sm:leading-[52px]">
          <CountUp value={y.tripCount} />
          <span className="ml-0.5 font-sans text-[20px] font-medium tracking-normal text-ink-3">
            회
          </span>
        </span>
        <Divider />
        <Fig value={<CountUp value={y.days} />} unit="일" />
        {y.overseas.length > 0 ? (
          <>
            <Divider />
            <span className="num text-[22px] leading-7 font-medium text-ink">
              <span className="font-sans tracking-normal">해외</span> {y.overseas.length}
              <span className="ml-0.5 font-sans text-[15px] font-medium tracking-normal text-ink-3">
                · {y.overseas.join(", ")}
              </span>
            </span>
          </>
        ) : null}
        {y.spendRecordedCount > 0 ? (
          <>
            <Divider />
            <span className="flex basis-full items-baseline gap-2.5 sm:basis-auto">
              <Fig value={<CountUp value={y.spendTotal} />} unit="원" />
              <span className="text-xs text-ink-3 sm:hidden">
                지출 · 기록 있는 {y.spendRecordedCount}건
              </span>
            </span>
          </>
        ) : null}
      </div>
      <p className="m-0 hidden text-[13px] leading-5 text-ink-3 sm:block">
        올해 지난 <span className="num">{y.elapsedDays}</span>일 중{" "}
        <span className="num">{(Math.round(share * 1000) / 10).toLocaleString("ko-KR")}%</span>를
        밖에서
        {y.spendRecordedCount > 0
          ? ` · 지출은 Toss 기록이 있는 ${y.spendRecordedCount}건의 합계`
          : ""}
        {y.spendMissingCount > 0 && y.spendingSince
          ? `, ${monthDay(y.spendingSince)} 이전 ${y.spendMissingCount}건은 기록 없음`
          : ""}
      </p>
      <InsightLine insight={fact} className="max-w-[760px]" />
      <YearRibbon summary={summary} today={today} />
    </section>
  );
}

// ── highlights ──────────────────────────────────────────────────────────────

function HighlightCard({
  highlight,
  spendingSince,
}: {
  highlight: Highlight;
  spendingSince: string | null;
}) {
  const { trip } = highlight;
  const recorded = isSpendingRecorded(trip, spendingSince);
  return (
    <article className="surface flex flex-col gap-[18px] p-5 transition-shadow duration-150 hover:shadow-ring-hover sm:p-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-4">
          <h3 className="m-0 font-serif text-[22px] leading-[30px] font-semibold tracking-[-0.02em]">
            <Link
              href={`/travel/${trip.id}`}
              className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-brand"
            >
              {destinationOf(trip)}
            </Link>
          </h3>
          <Pill className="mt-1 max-sm:bg-transparent max-sm:px-0 max-sm:font-medium max-sm:shadow-none">
            {highlight.tag}
          </Pill>
        </div>
        <span className="text-sm leading-[22px] text-ink-2">
          {rangeWithWeekdays(trip.startDate, trip.endDate)} ·{" "}
          {stayLabel(trip.startDate, trip.endDate)}
        </span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
        <div className="flex flex-col gap-0.5">
          <Fig value={formatCount((trip.totalDistanceMeters ?? 0) / 1000)} unit="km" />
          <span className="text-label">이동</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <Fig value={formatCount(trip.visitCount)} unit="곳" />
          <span className="text-label">방문</span>
        </div>
        <div className="flex flex-col gap-0.5">
          {recorded ? (
            <Fig value={formatCount(trip.totalSpending)} unit="원" />
          ) : (
            <span className="text-[15px] leading-7 text-ink-3">기록 없음</span>
          )}
          <span className="text-label">{highlight.spendLabel}</span>
        </div>
      </div>
      {highlight.fact ? (
        <InsightLine insight={highlight.fact} className="border-t border-line pt-3.5" />
      ) : null}
    </article>
  );
}

// ── rows ────────────────────────────────────────────────────────────────────

interface RowActions {
  spendingSince: string | null;
  onNotTrip: (trip: TravelTripListItem) => void;
  onRename: (tripId: string, name: string) => Promise<boolean>;
}

function SpendCell({
  trip,
  spendingSince,
  small,
}: {
  trip: TravelTripListItem;
  spendingSince: string | null;
  small?: boolean;
}) {
  return isSpendingRecorded(trip, spendingSince) ? (
    <span className={cn("num text-ink", small ? "text-[13px]" : "text-sm")}>
      {formatWon(trip.totalSpending)}
    </span>
  ) : (
    <span className={cn("text-ink-3", small ? "text-[13px]" : "text-sm")}>기록 없음</span>
  );
}

function TripRow({
  trip,
  actions,
  nested,
  year,
}: {
  trip: TravelTripListItem;
  actions: RowActions;
  nested?: boolean;
  /** The year the surrounding list is about; rows from another year say theirs. */
  year?: number;
}) {
  const cities = cityLine(trip.visitedCities);
  const tripYear = Number(trip.startDate.slice(0, 4));
  const yearPrefix = year !== undefined && tripYear !== year ? `${tripYear}년 ` : "";
  return (
    <div
      className={cn(
        "relative flex cursor-pointer items-center gap-3 border-b border-line transition-colors duration-150 hover:bg-[color-mix(in_oklab,var(--track)_60%,transparent)] lg:px-3",
        COLS,
        nested ? "py-2.5 lg:border-t lg:border-b-0" : "py-3 lg:py-3.5"
      )}
    >
      <span className={cn("hidden text-[13px] text-ink-2 lg:block", nested && "pl-4")}>
        {yearPrefix}
        {rangeLabel(trip.startDate, trip.endDate)}{" "}
        <span className="text-ink-3">({weekdayRange(trip.startDate, trip.endDate)})</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* Stretched link: its ::after covers the whole row, so the dates, km and
            amount all open the trip; the ⋯ menu sits above it (z-[1]). */}
        <Link
          href={`/travel/${trip.id}`}
          className={cn(
            "flex items-center gap-2 outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-solid focus-visible:after:outline-brand",
            nested ? "text-sm font-medium" : "text-[15px] leading-[22px] font-semibold"
          )}
        >
          {nested && cities ? (
            // Narrow phones name the first two cities and count the rest
            // ("… 외 N곳") rather than cutting a name mid-word.
            <span className="truncate" title={cities}>
              <span className="lg:hidden">{cityLine(trip.visitedCities, 2)}</span>
              <span className="hidden lg:inline">{cities}</span>
            </span>
          ) : (
            <span className="truncate">{destinationOf(trip)}</span>
          )}
          {trip.isOverseas ? <Pill className="h-[22px] font-medium">해외</Pill> : null}
        </Link>
        {/* Narrow phones drop the stay length (and, in a group, shorten the
            year) before the km would be cut; the km itself never shrinks. */}
        <span className="flex min-w-0 text-xs leading-4 whitespace-nowrap text-ink-3 lg:hidden">
          <span className="min-w-0 truncate">
            {yearPrefix ? (
              <>
                <span className="max-[359px]:hidden">{yearPrefix}</span>
                <span className="min-[360px]:hidden">{yearPrefix.slice(2)}</span>
              </>
            ) : null}
            {rangeLabel(trip.startDate, trip.endDate)}
            <span className="max-[359px]:hidden"> · {stayLabel(trip.startDate, trip.endDate)}</span>
          </span>
          <span className="shrink-0">
            {/* nbsp: a flex item's leading space would collapse. */}
            {"\u00a0· "}
            {formatKm(trip.totalDistanceMeters)}
          </span>
        </span>
        {!nested ? (
          <>
            <span className="hidden truncate text-xs leading-4 text-ink-3 lg:block xl:hidden">
              {cityLine(trip.visitedCities, 2)}
            </span>
            <span className="hidden truncate text-xs leading-4 text-ink-3 xl:block">{cities}</span>
          </>
        ) : null}
      </span>
      <span
        className={cn(
          "hidden text-ink lg:block",
          faceOf(stayLabel(trip.startDate, trip.endDate)),
          nested ? "text-[13px] text-ink-2" : "text-sm"
        )}
      >
        {stayLabel(trip.startDate, trip.endDate)}
      </span>
      <span className={cn("num hidden text-right lg:block", nested ? "text-[13px]" : "text-sm")}>
        {formatKm(trip.totalDistanceMeters)}
      </span>
      <span className={cn("num hidden text-right lg:block", nested ? "text-[13px]" : "text-sm")}>
        {formatCount(trip.visitCount)}
      </span>
      <span className="shrink-0 text-right">
        <SpendCell trip={trip} spendingSince={actions.spendingSince} small={nested} />
      </span>
      <span className="relative z-[1] grid shrink-0 place-items-center">
        <TripMenu
          tripId={trip.id}
          tripName={trip.name}
          tripLabel={`${destinationOf(trip)} ${tripYear}년 ${rangeLabel(trip.startDate, trip.endDate)}`}
          detailHref={`/travel/${trip.id}`}
          onRename={(name) => actions.onRename(trip.id, name)}
          onNotTrip={() => actions.onNotTrip(trip)}
        />
      </span>
    </div>
  );
}

function GroupRow({
  group,
  actions,
  year,
}: {
  group: RecurringGroup;
  actions: RowActions;
  year: number;
}) {
  const [open, setOpen] = useState(false);
  const { stateOf, isActive } = useEvidence();
  const id = useId();
  const thisYear = group.trips.filter((t) => t.startDate.startsWith(String(year))).length;
  const lit = isActive && group.trips.some((t) => stateOf(t.id) === "on");
  const wd = group.topWeekday;
  const latest = group.trips.reduce<TravelTripListItem | null>(
    (best, t) => (!best || t.startDate > best.startDate ? t : best),
    null
  );
  return (
    <div
      className={cn(
        "border-b border-line transition-colors duration-150",
        lit && "bg-[color-mix(in_oklab,var(--brand-soft)_70%,transparent)]"
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent py-3 text-left text-ink transition-colors duration-150 hover:bg-[color-mix(in_oklab,var(--track)_60%,transparent)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-brand lg:px-3 lg:py-3.5",
          COLS
        )}
      >
        <span className="hidden text-[13px] text-ink-2 lg:block">
          {yearMonth(group.firstStart)}–{yearMonth(group.lastEnd)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-[15px] leading-[22px] font-semibold">
            {groupLabel(group)}
            <span className="inline-flex h-[22px] items-center rounded-full bg-surface px-[9px] text-xs font-medium shadow-[inset_0_0_0_1px_var(--line)]">
              <span className="num">{group.trips.length}</span>회 반복
            </span>
          </span>
          <span className="truncate text-xs leading-4 text-ink-3">
            {/* Narrow phones keep "올해 N회" whole and drop the span of months. */}
            <span className="lg:hidden max-[359px]:hidden">
              {yearMonth(group.firstStart)}–{yearMonth(group.lastEnd)} ·{" "}
            </span>
            올해 {thisYear}회
            {wd && wd.count >= 2 ? (
              <span className="hidden xl:inline">
                {" "}
                · {wd.weekday}요일 출발 {wd.count}회
              </span>
            ) : null}
            {latest ? (
              <span className="hidden lg:inline">
                {" "}
                · 최근 {rangeLabel(latest.startDate, latest.endDate)}
              </span>
            ) : null}
          </span>
        </span>
        <span className="num hidden text-sm lg:block">{group.totalDays}일</span>
        <span className="num hidden text-right text-sm lg:block">
          {formatKm(group.totalMeters)}
        </span>
        <span className="num hidden text-right text-sm lg:block">
          {formatCount(group.totalVisits)}
        </span>
        <span className="flex shrink-0 flex-col items-end text-right">
          <span className="num text-sm lg:hidden">{group.totalDays}일</span>
          <span
            className={cn(
              "hidden text-sm lg:block",
              group.spendRecordedCount > 0 ? "num" : "text-ink-3"
            )}
          >
            {group.spendRecordedCount > 0 ? formatWon(group.spendTotal) : "기록 없음"}
          </span>
          <span className="num text-xs text-ink-3 lg:hidden">{formatKm(group.totalMeters)}</span>
          {group.spendRecordedCount > 0 ? (
            <span className="hidden text-[11px] text-ink-3 lg:block">
              기록 있는 {group.spendRecordedCount}회
            </span>
          ) : null}
        </span>
        <span className="grid w-8 shrink-0 place-items-center text-ink-2 max-sm:w-11">
          <Chevron />
        </span>
      </button>
      <Disclosure open={open} id={id}>
        <div className="pl-3 lg:pl-0">
          {group.trips.map((trip) => (
            <TripRow key={trip.id} trip={trip} actions={actions} nested year={year} />
          ))}
        </div>
      </Disclosure>
    </div>
  );
}

function TripList({
  trips,
  summary,
  groups,
  rest,
  actions,
  hasMore,
  isLoading,
  loadMore,
}: {
  trips: TravelTripListItem[];
  summary: TravelListSummary | null;
  groups: RecurringGroup[];
  rest: TravelTripListItem[];
  actions: RowActions;
  hasMore: boolean;
  isLoading: boolean;
  loadMore: () => void;
}) {
  const oldest = trips.at(-1);
  const years = byYear(rest);
  const groupedIn = (year: number) =>
    groups
      .map((g) => ({ g, n: g.trips.filter((t) => t.startDate.startsWith(String(year))).length }))
      .filter((x) => x.n > 0);
  const year = summary?.year ?? new Date().getFullYear();
  return (
    <section
      aria-labelledby="travel-list-h"
      className={cn("mt-14 flex flex-col lg:mt-[72px]", enter(3).className)}
      style={enter(3).style}
    >
      <div className="flex items-baseline justify-between pb-3">
        <h2
          id="travel-list-h"
          className="m-0 font-serif text-[20px] leading-7 font-semibold tracking-[-0.02em] sm:text-[22px] sm:leading-[30px]"
        >
          모든 여행
        </h2>
        {oldest ? (
          <span className="text-label">
            <span className="hidden sm:inline">
              {yearMonth(oldest.startDate)} {Number(oldest.startDate.slice(8))}일 이후{" "}
            </span>
            {trips.length}건
          </span>
        ) : null}
      </div>
      <div aria-hidden="true" className={cn("hidden border-b border-line px-3 py-2", COLS)}>
        <span className="text-label">날짜</span>
        <span className="text-label">여행</span>
        <span className="text-label">기간</span>
        <span className="text-label text-right">이동</span>
        <span className="text-label text-right">방문</span>
        <span className="text-label text-right">지출</span>
        <span />
      </div>
      <div className="border-t border-line lg:border-t-0">
        {groups.map((group) => (
          <GroupRow key={group.key} group={group} actions={actions} year={year} />
        ))}
      </div>
      {years.map(({ year: y, trips: list }, index) => {
        const folded = groupedIn(y);
        const partial = hasMore && index === years.length - 1 && oldest;
        return (
          <div key={y}>
            <div className="flex items-baseline gap-2.5 border-b border-line pt-7 pb-2 lg:px-3">
              <span className="font-serif text-[15px] leading-[22px] font-semibold">{y}년</span>
              <span className="text-label">
                {partial ? (
                  <span className="hidden sm:inline">
                    {Number(oldest.startDate.slice(5, 7))}월 {Number(oldest.startDate.slice(8))}일
                    이후{" "}
                  </span>
                ) : null}
                {list.length}건
                {folded.length > 0 ? (
                  <span className="hidden sm:inline">
                    {" · "}
                    {folded
                      .map((x) => `${groupLabel(x.g).replace(" · ", " ")} ${x.n}건`)
                      .join(", ")}
                    은 위에 묶음
                  </span>
                ) : null}
              </span>
            </div>
            {list.map((trip) => (
              <TripRow key={trip.id} trip={trip} actions={actions} />
            ))}
          </div>
        );
      })}
      {hasMore && oldest ? (
        <div className="flex justify-center pt-5">
          <Button
            variant="outline"
            onClick={loadMore}
            disabled={isLoading}
            className="max-sm:h-11 max-sm:w-full"
          >
            {yearMonth(oldest.startDate)} 이전 여행 더 보기
          </Button>
        </div>
      ) : null}
    </section>
  );
}

// ── page body ───────────────────────────────────────────────────────────────

export function TravelListView({
  trips,
  summary,
  today,
  isLoading,
  error,
  hasMore,
  loadMore,
  refresh,
  scheduleNotTrip,
  undoNotTrip,
  renameTrip,
}: TravelListViewProps) {
  if (isLoading && trips.length === 0) {
    return <LoadingState variant="rows" rows={6} className="mt-10" label="여행 불러오는 중" />;
  }
  if (error && trips.length === 0) {
    return (
      <ErrorState
        className="mt-10"
        title="여행 목록을 불러오지 못했어요"
        description={error}
        actions={
          <Button variant="outline" onClick={refresh}>
            다시 시도
          </Button>
        }
      />
    );
  }
  if (trips.length === 0) {
    return (
      <EmptyState
        className="mt-10"
        title="아직 기록된 여행이 없어요"
        description="위치 기록에서 여행이 감지되면 여기에 나타나요. 감지는 매주 일요일에 돌아요."
      />
    );
  }

  const spendingSince = summary?.spendingSince ?? null;
  const all = [...trips];
  const { groups, rest } = groupRecurring(all, spendingSince);
  const highlights = summary ? pickHighlights(summary) : [];
  const actions: RowActions = {
    spendingSince,
    onRename: renameTrip,
    onNotTrip: (trip) => {
      scheduleNotTrip(trip);
      toast(
        `${destinationOf(trip)} ${rangeLabel(trip.startDate, trip.endDate)}을 여행에서 뺐어요`,
        {
          duration: NOT_TRIP_UNDO_MS,
          action: { label: "되돌리기", onClick: () => undoNotTrip(trip.id) },
        }
      );
    },
  };

  return (
    <EvidenceScope>
      {error ? (
        <p role="alert" className="mt-6 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      {summary && summary.trips.length > 0 ? (
        <YearHero summary={summary} groups={groups} today={today} />
      ) : null}
      {highlights.length > 0 ? (
        <section
          aria-labelledby="travel-hl-h"
          className={cn("mt-14 flex flex-col gap-4 sm:gap-5 lg:mt-[72px]", enter(2).className)}
          style={enter(2).style}
        >
          <h2
            id="travel-hl-h"
            className="m-0 font-serif text-[20px] leading-7 font-semibold tracking-[-0.02em] sm:text-[22px] sm:leading-[30px]"
          >
            올해 눈에 띈 여행
          </h2>
          <div className="grid gap-3 sm:gap-6 lg:grid-cols-2">
            {highlights.map((h) => (
              <HighlightCard key={h.trip.id} highlight={h} spendingSince={spendingSince} />
            ))}
          </div>
        </section>
      ) : null}
      <TripList
        trips={trips}
        summary={summary}
        groups={groups}
        rest={rest}
        actions={actions}
        hasMore={hasMore}
        isLoading={isLoading}
        loadMore={loadMore}
      />
    </EvidenceScope>
  );
}
