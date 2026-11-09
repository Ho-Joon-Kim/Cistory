"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AiLine,
  ArrowRight,
  Chevron,
  CountUp,
  Disclosure,
  EmptyState,
  ErrorState,
  EvidenceScope,
  LoadingState,
  PageTitle,
  Segmented,
  SourceTile,
  StatusBadge,
  useEvidence,
} from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSession } from "@/lib/auth-client";
import { shiftDateKey, toKstCalendarDate } from "@/lib/date-key";
import type { Fact } from "@/lib/facts/types";
import {
  formatCount,
  formatDateRange,
  formatDateTime,
  formatMonthDay,
  formatRelative,
  formatTime,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  buildHero,
  buildSourceView,
  focusFact,
  formatDateRuns,
  METER_ORDER,
  recoveryRange,
  rowFact,
  rowSubline,
  SOURCE_NAMES,
  type SourceView,
  sortBySeverity,
} from "../insights";
import type { DataStatusResponse, RecoveryJob, SourceId } from "../types";
import { CELL_LABELS, cellStyle, cellText, StatusStrip } from "./StatusStrip";

type RangeDays = "7" | "30";
const RANGE_ITEMS = [
  { value: "7" as const, label: "7일", ariaLabel: "최근 7일" },
  { value: "30" as const, label: "30일", ariaLabel: "최근 30일" },
];

const ROW_LINKS: Partial<Record<SourceId, { href: string; label: string }>> = {
  github: { href: "/dashboard", label: "타임라인에서 동기화" },
  location: { href: "/settings", label: "파일 가져오기" },
  toss: { href: "/spending", label: "소비 화면에서 재분석" },
  kis: { href: "/settings", label: "계좌 설정" },
};

/** OAuth entry points for a confirmed auth failure (full-page redirect). */
const REAUTH_HREF: Partial<Record<SourceId, string>> = {
  wakatime: "/api/wakatime/authorize",
  withings: "/api/withings/authorize",
  health: "/api/fitbit/authorize",
};

const ACTIVE = (job: RecoveryJob) => job.status === "pending" || job.status === "running";

function dayCount(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function withEvidence(fact: Fact | null, keys: string[]): Fact | null {
  return fact ? { ...fact, evidence: { kind: "keys", keys } } : null;
}

const GRID =
  "lg:grid lg:grid-cols-[200px_80px_80px_minmax(0,1fr)_88px_24px] lg:items-center lg:gap-x-4 xl:grid-cols-[232px_88px_96px_minmax(0,1fr)_104px_32px] xl:gap-x-5";

export function DataStatusView({ enabled }: { enabled: boolean }) {
  const { data: session } = useSession();
  const client = useQueryClient();
  const [now] = useState(() => new Date());
  const today = toKstCalendarDate(now);
  const [rangeDays, setRangeDays] = useState<RangeDays>("30");
  const range = { from: shiftDateKey(today, -(Number(rangeDays) - 1)), to: today };
  const [open, setOpen] = useState<Partial<Record<SourceId, boolean>>>({});
  const [hover, setHover] = useState<{ row: SourceId; index: number } | null>(null);

  const query = useQuery<DataStatusResponse>({
    queryKey: ["data-status", session?.session.id, range.from, range.to],
    enabled,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/data-status?${new URLSearchParams(range)}`, { signal });
      if (!response.ok) throw new Error("수집 상태를 불러오지 못했습니다.");
      return response.json();
    },
    refetchInterval: (q) => (q.state.data?.jobs.some(ACTIVE) ? 5_000 : 30_000),
  });

  const recovery = useMutation({
    mutationFn: async (input: { source: string; from: string; to: string }) => {
      const response = await fetch("/api/data-status/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "재수집을 요청하지 못했습니다.");
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["data-status"] }),
  });

  const data = query.data;
  const views = useMemo(
    () => (data ? data.sources.map((s) => buildSourceView(s, now)) : []),
    [data, now]
  );
  const sorted = useMemo(() => sortBySeverity(views), [views]);
  const hero = useMemo(() => (views.length ? buildHero(views) : null), [views]);

  const jobFor = (id: SourceId) => data?.jobs.find((job) => job.source === id && ACTIVE(job));
  const isBusy = (id: SourceId) =>
    (recovery.isPending && recovery.variables?.source === id) || !!jobFor(id);
  const recover = (view: SourceView) => {
    const r = recoveryRange(view);
    recovery.mutate({ source: view.id, from: r.from, to: r.to });
  };
  const openRow = (id: SourceId) => {
    setOpen((o) => ({ ...o, [id]: true }));
    requestAnimationFrame(() =>
      document
        .getElementById(`source-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" })
    );
  };

  const rangeText = formatDateRange(range.from, range.to, { now });

  return (
    <>
      <div className="ds-enter flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <nav aria-label="위치" className="text-[13px] text-ink-3">
            <Link href="/settings" className="text-ink-2 no-underline hover:text-ink">
              설정
            </Link>
            <span aria-hidden="true" className="mx-1.5">
              /
            </span>
            수집 상태
          </nav>
          <PageTitle
            title="수집 상태"
            meta={
              <>
                <span className="num">{rangeText}</span> · {rangeDays}일 · 소스 {views.length || 7}
                개
              </>
            }
          />
        </div>
        <Segmented
          items={RANGE_ITEMS}
          value={rangeDays}
          onChange={(value) => {
            setRangeDays(value);
            setHover(null);
          }}
          ariaLabel="기간"
          fullWidth="never"
          className="[&>button]:w-16"
        />
      </div>

      {recovery.error ? (
        <p role="alert" className="mt-4 text-sm text-gain">
          {recovery.error.message}
        </p>
      ) : null}
      {recovery.isSuccess ? (
        <p role="status" className="mt-4 text-sm text-ink-2">
          재수집 요청이 접수됐어요. 백그라운드에서 하루씩 처리되며 페이지를 닫아도 계속돼요.
        </p>
      ) : null}

      {query.isError ? (
        <ErrorState
          className="mt-8"
          title={query.error.message}
          description="잠시 후 다시 시도해 주세요. 날짜는 한국 시간 기준입니다."
          actions={
            <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
              새로고침
            </Button>
          }
        />
      ) : !data || !hero ? (
        <LoadingState variant="rows" rows={7} className="mt-8" label="수집 상태를 불러오는 중" />
      ) : (
        <>
          <section
            aria-label="요약"
            className="ds-enter mt-8 grid grid-cols-1 gap-8 [animation-delay:100ms] lg:grid-cols-12 lg:gap-6"
          >
            <HeroSummary hero={hero} views={views} onOpenRow={openRow} now={now} />
            <FocusPanel
              hero={hero}
              views={views}
              now={now}
              rangeText={rangeText}
              job={hero.focus ? jobFor(hero.focus.id) : undefined}
              busy={hero.focus ? isBusy(hero.focus.id) : false}
              onRecover={recover}
            />
          </section>

          <section
            aria-labelledby="sources-heading"
            className="ds-enter mt-12 [animation-delay:200ms] lg:mt-14"
          >
            <div className="mb-3 flex items-baseline justify-between gap-4">
              <h2
                id="sources-heading"
                className="m-0 font-serif text-xl leading-7 font-semibold tracking-[-0.02em] lg:text-[22px] lg:leading-[30px]"
              >
                소스별 기록
              </h2>
              <span className="text-[13px] text-ink-3">문제가 있는 소스부터</span>
            </div>
            <div
              className={cn(
                "hidden h-10 border-b border-line text-xs font-medium text-ink-3",
                GRID
              )}
            >
              <span>소스</span>
              <span>상태</span>
              <span>마지막 성공</span>
              <AxisLabels days={sorted[0]?.cells.map((c) => c.date) ?? []} now={now} />
              <span className="text-right">{rangeDays}일 합계</span>
              <span />
            </div>
            <div className="flex items-center justify-between border-b border-line py-2 lg:hidden">
              <span className="text-xs text-ink-3">하루 기록 수 · 모든 소스 같은 눈금</span>
              <Legend />
            </div>
            <ul className="m-0 list-none p-0">
              {sorted.map((view) => (
                <SourceRow
                  key={view.id}
                  view={view}
                  views={views}
                  now={now}
                  open={!!open[view.id]}
                  onToggle={() => setOpen((o) => ({ ...o, [view.id]: !o[view.id] }))}
                  hoverIndex={hover?.index ?? null}
                  tooltipHere={hover?.row === view.id}
                  onHover={(index) => setHover(index === null ? null : { row: view.id, index })}
                  jobs={data.jobs.filter((job) => job.source === view.id)}
                  busy={isBusy(view.id)}
                  onRecover={() => recover(view)}
                />
              ))}
            </ul>
            <p className="mt-5 text-[13px] leading-5 text-ink-3">
              날짜는 한국 시간 기준이에요. 기록이 없는 날은 활동이 없었을 수도 있어 수집 실패로
              단정하지 않아요. 재수집은 1분마다 최대 3일씩 하루 단위로 처리돼요.
            </p>
          </section>
        </>
      )}
    </>
  );
}

// ── Hero ────────────────────────────────────────────────────────────────────

function meterColor(view: SourceView) {
  switch (view.status) {
    case "failed":
      return "var(--up)";
    case "reauth":
    case "delayed":
      return "var(--warn)";
    case "disconnected":
      return "var(--track)";
    default:
      return "var(--brand)";
  }
}

function HeroSummary({
  hero,
  views,
  onOpenRow,
  now,
}: {
  hero: NonNullable<ReturnType<typeof buildHero>>;
  views: SourceView[];
  onOpenRow: (id: SourceId) => void;
  now: Date;
}) {
  const ordered = METER_ORDER.map((id) => views.find((v) => v.id === id)).filter(
    (v): v is SourceView => !!v
  );
  const gap = hero.gapNote;
  return (
    <div className="flex flex-col justify-center gap-7 py-1 lg:col-span-5">
      <div className="flex flex-col gap-4">
        <h2 className="m-0 font-serif text-[22px] leading-[30px] font-bold tracking-[-0.02em] sm:text-[28px] sm:leading-[38px]">
          {hero.headline}
          {hero.subline ? (
            <>
              <br />
              {hero.subline}
            </>
          ) : null}
        </h2>
        <div className="grid max-w-[460px] grid-cols-7 gap-1">
          {ordered.map((view, i) => (
            <span
              key={view.id}
              className="ds-pop h-1.5 rounded-full"
              style={{ background: meterColor(view), animationDelay: `${300 + i * 60}ms` }}
              aria-hidden="true"
            />
          ))}
          {ordered.map((view) => (
            <span
              key={`${view.id}-label`}
              className={cn(
                "-mt-0.5 truncate text-[11px] leading-[14px]",
                view.status === "failed"
                  ? "text-gain"
                  : view.status === "reauth" || view.status === "delayed"
                    ? "text-warn"
                    : "text-ink-3"
              )}
            >
              {SOURCE_NAMES[view.id].short}
              <span className="sr-only"> {view.status === "ok" ? "정상" : view.status}</span>
            </span>
          ))}
        </div>
      </div>
      {gap ? (
        <p className="m-0 max-w-[460px] text-sm leading-[22px] text-ink-2">
          {gap.name} 기록은 <span className="num">{formatDateRuns(gap.gaps, now)}</span>이 비어
          있습니다.{" "}
          <button
            type="button"
            onClick={() => onOpenRow(gap.id)}
            className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-semibold text-brand hover:underline hover:underline-offset-[3px]"
          >
            {gap.source.canRecover ? "재수집하기" : "자세히"}
            <ArrowRight />
          </button>
        </p>
      ) : (
        <p className="m-0 max-w-[460px] text-sm leading-[22px] text-ink-2">
          {hero.focus
            ? "다른 소스에는 들어와야 할 기록이 빠진 날이 없어요."
            : "들어와야 할 기록이 빠진 날이 없어요."}
        </p>
      )}
    </div>
  );
}

function Kpi({
  label,
  children,
  sub,
  className,
}: {
  label: string;
  children: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col justify-end gap-1 py-4", className)}>
      <span className="text-label">{label}</span>
      {children}
      {sub ? <span className="text-xs leading-4 text-ink-3">{sub}</span> : null}
    </div>
  );
}

const WEEKDAY_NAMES = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

function FocusPanel({
  hero,
  views,
  now,
  rangeText,
  job,
  busy,
  onRecover,
}: {
  hero: NonNullable<ReturnType<typeof buildHero>>;
  views: SourceView[];
  now: Date;
  rangeText: string;
  job: RecoveryJob | undefined;
  busy: boolean;
  onRecover: (view: SourceView) => void;
}) {
  const view = hero.focus;
  if (!view) {
    const latest = views
      .map((v) => v.source.lastSuccessAt)
      .filter((v): v is string => !!v)
      .sort()
      .at(-1);
    const total = views.reduce((sum, v) => sum + v.total, 0);
    return (
      <div className="surface flex flex-col gap-5 p-5 sm:p-6 lg:col-span-7">
        <EmptyState
          icon={
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
          }
          title="모든 소스가 들어오고 있어요"
          description="연결된 소스에 실패·지연·공백이 없어요. 문제가 생기면 여기에서 원인과 해결 방법을 보여 드려요."
        />
        <div className="grid grid-cols-2 border-y border-line">
          <Kpi label="이 기간 기록" sub={`소스 ${views.length}개 합계`} className="pr-4">
            <CountUp value={total} className="text-[22px] leading-7 font-medium" />
          </Kpi>
          <Kpi label="가장 최근 동기화" className="border-l border-line pl-4">
            <span className="num text-[22px] leading-7 font-medium">
              {latest ? formatRelative(latest, now) : "없음"}
            </span>
          </Kpi>
        </div>
      </div>
    );
  }

  const failing = view.status !== "ok";
  const fact = withEvidence(focusFact(view, views, now), failing ? [] : view.gaps);
  const last = view.source.lastSuccessAt ? new Date(view.source.lastSuccessAt) : null;
  const r = recoveryRange(view);
  const recordDays = view.cells.filter((c) => c.count > 0).length;
  const unit = SOURCE_NAMES[view.id].unit;
  const processed = job ? Math.max(0, dayCount(job.fromDate, job.nextDate)) : 0;
  const jobTotal = job ? dayCount(job.fromDate, job.toDate) + 1 : 0;
  const description = view.source.error
    ? view.source.error
    : view.status === "reauth"
      ? "제공자가 인증을 거부했어요. 설정에서 다시 연결해 주세요."
      : view.status === "delayed"
        ? "48시간 넘게 동기화에 성공하지 못했어요."
        : `들어와야 할 기록이 ${view.gaps.length}일 비어 있어요.`;

  return (
    <div className="surface flex min-w-0 flex-col gap-5 p-5 sm:p-6 lg:col-span-7">
      <div className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-3">
        <SourceTile icon={view.id} />
        <span className="text-[15px] leading-[22px] font-semibold sm:col-start-2">{view.name}</span>
        <StatusBadge
          status={view.status === "ok" ? "delayed" : view.status}
          label={view.status === "ok" ? "공백" : undefined}
          className="sm:row-span-2"
        />
        <span className="col-span-3 mt-2 text-[13px] leading-[18px] text-ink-2 sm:col-span-1 sm:col-start-2 sm:mt-0">
          {description}
        </span>
      </div>
      <EvidenceScope>
        <AiLine fact={fact} className="-mt-1.5 max-w-[620px]" />
      </EvidenceScope>
      <div className="grid grid-cols-2 border-y border-line sm:grid-cols-[1.15fr_1fr_1fr]">
        <Kpi label={failing ? "미동기화" : "공백"} className="col-span-2 pr-5 sm:col-span-1">
          <span className="num text-[40px] leading-[44px] font-medium sm:text-5xl sm:leading-[52px]">
            <CountUp
              value={failing ? (view.daysSinceSuccess ?? view.cells.length) : view.gaps.length}
            />
            <span className="text-[0.45em] text-ink-3">일</span>
          </span>
        </Kpi>
        <Kpi
          label="마지막 성공"
          className="border-t border-line pr-4 sm:border-t-0 sm:border-l sm:px-5"
          sub={
            last
              ? `${formatRelative(last, now)} · ${WEEKDAY_NAMES[new Date(last.getTime() + 9 * 3_600_000).getUTCDay()]}`
              : "확인된 이력 없음"
          }
        >
          <span className="num text-xl leading-7 font-medium whitespace-nowrap sm:text-[22px] lg:text-lg xl:text-[22px]">
            {last ? `${formatMonthDay(last, { now })} ${formatTime(last)}` : "없음"}
          </span>
        </Kpi>
        <Kpi
          label="이 기간 기록"
          className="border-t border-l border-line pl-4 sm:border-t-0 sm:pl-5"
          sub={view.total > 0 ? `${recordDays}일치 · ${unit}` : `${unit} 0건`}
        >
          <span className="num text-xl leading-7 font-medium whitespace-nowrap sm:text-[22px] lg:text-lg xl:text-[22px]">
            {view.total > 0 ? formatCount(view.total) : "없음"}
          </span>
        </Kpi>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {view.source.canRecover ? (
          busy ? (
            <Button variant="outline" disabled className="text-ink-2">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-warn" />
              재수집 진행 중
            </Button>
          ) : (
            <Button onClick={() => onRecover(view)}>
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5" />
              </svg>
              {failing ? "기간 재수집" : `${formatDateRange(r.from, r.to, { now })} 재수집`}
            </Button>
          )
        ) : REAUTH_HREF[view.id] && view.status === "reauth" ? (
          <Button asChild>
            <a href={REAUTH_HREF[view.id]}>다시 연결</a>
          </Button>
        ) : null}
        <Button variant="ghost" asChild>
          <Link href="/settings">
            설정에서 연결 확인
            <ArrowRight />
          </Link>
        </Button>
        <span className="ml-auto text-[13px] text-ink-3">
          {job
            ? "1분마다 최대 3일씩 처리"
            : `범위 ${failing ? rangeText : formatDateRange(r.from, r.to, { now })}`}
        </span>
      </div>
      {job ? (
        <div className="ds-pop flex flex-col gap-2 pt-1">
          <div className="flex justify-between text-[13px]">
            <span className="text-ink-2">
              {formatDateRange(job.fromDate, job.toDate, { now })} · 하루씩 처리 ·{" "}
              {formatMonthDay(job.nextDate, { now })}부터{" "}
              {job.status === "running" ? "처리 중" : "대기 중"}
            </span>
            <span className="num text-ink-3">
              {processed} / {jobTotal}일
            </span>
          </div>
          <div className="h-1 rounded-full bg-track">
            <div
              className="ds-growx h-1 rounded-full bg-brand"
              style={{ width: `${Math.max(3, (processed / Math.max(1, jobTotal)) * 100)}%` }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Table ───────────────────────────────────────────────────────────────────

function AxisLabels({ days, now }: { days: string[]; now: Date }) {
  const n = days.length;
  const marks = new Set(n <= 7 ? days.map((_, i) => i) : [0, 7, 14, 21, n - 1]);
  return (
    <div className="relative flex h-10 items-center">
      <div
        className="grid w-full items-center gap-0.5 xl:gap-1"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      >
        {days.map((day, i) => (
          <span
            key={day}
            className={cn(
              "num overflow-visible text-[11px] whitespace-nowrap",
              i === n - 1 ? "font-semibold text-brand" : "font-medium text-ink-3"
            )}
          >
            {marks.has(i)
              ? i === n - 1
                ? "오늘"
                : n <= 7
                  ? `${Number(day.slice(8))}일`
                  : formatMonthDay(day, { now })
              : ""}
          </span>
        ))}
      </div>
      <span className="absolute top-1.5 -right-8 xl:-right-[34px]">
        <Legend />
      </span>
    </div>
  );
}

function LegendCell({
  kind = "none",
  level = 0,
}: {
  kind?: Parameters<typeof cellStyle>[0];
  level?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-3.5 rounded-[3px] align-[-2px]"
      style={cellStyle(kind, level)}
    />
  );
}

function Legend() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="칸 농도 설명"
          className="grid size-7 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-ink-2 hover:bg-track hover:text-ink"
        >
          <svg
            aria-hidden="true"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" />
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-[300px] flex-col gap-2.5 p-3.5 text-xs leading-[18px]"
      >
        <span className="text-[13px] font-semibold text-ink">
          하루 기록 수 · 모든 소스 같은 눈금
        </span>
        <div className="flex flex-wrap items-center gap-2.5 text-ink-2">
          {[
            [1, "1"],
            [2, "10"],
            [3, "100"],
            [4, "1천"],
            [5, "1만+"],
          ].map(([level, label]) => (
            <span key={label} className="inline-flex items-center gap-1">
              <LegendCell level={Number(level)} />
              <span className="num">{label}</span>
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-1.5 text-ink-2">
          <span>
            <LegendCell /> 기록 없음 — 커밋 없는 주말, 체중을 재지 않은 날처럼 정상일 수 있음
          </span>
          <span>
            <LegendCell kind="gap" /> {CELL_LABELS.gap} — 들어와야 할 기록이 빠진 날
          </span>
          <span>
            <LegendCell kind="fail" /> {CELL_LABELS.fail} 기간
          </span>
          <span>
            <LegendCell kind="pending" /> {CELL_LABELS.pending}
          </span>
          <span>
            <LegendCell kind="checked" /> {CELL_LABELS.checked}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RowEvidenceStrip(props: Omit<React.ComponentProps<typeof StatusStrip>, "evidence">) {
  const { isActive, stateOf } = useEvidence();
  const evidence = isActive
    ? new Set(props.cells.filter((c) => stateOf(c.date) === "on").map((c) => c.date))
    : null;
  return <StatusStrip {...props} evidence={evidence} />;
}

function SourceRow({
  view,
  views,
  now,
  open,
  onToggle,
  hoverIndex,
  tooltipHere,
  onHover,
  jobs,
  busy,
  onRecover,
}: {
  view: SourceView;
  views: SourceView[];
  now: Date;
  open: boolean;
  onToggle: () => void;
  hoverIndex: number | null;
  tooltipHere: boolean;
  onHover: (index: number | null) => void;
  jobs: RecoveryJob[];
  busy: boolean;
  onRecover: () => void;
}) {
  const sub = rowSubline(view, now);
  const fact = withEvidence(rowFact(view, now), view.gaps.length > 0 ? view.gaps : view.emptyDays);
  const last = view.source.lastSuccessAt ? new Date(view.source.lastSuccessAt) : null;
  const lastRecord = view.source.lastRecordAt ? new Date(view.source.lastRecordAt) : null;
  const unit = SOURCE_NAMES[view.id].unit;
  const link = ROW_LINKS[view.id];
  const total = view.total > 0 ? formatCount(view.total) : "없음";
  const panelId = `source-${view.id}-detail`;
  const r = recoveryRange(view);

  const tooltip =
    tooltipHere && hoverIndex !== null && view.cells[hoverIndex] ? (
      <CellTooltip views={views} index={hoverIndex} rowId={view.id} now={now} />
    ) : null;

  return (
    <li id={`source-${view.id}`} className="border-b border-line">
      <EvidenceScope>
        <div className={cn("relative py-3 lg:min-h-16", GRID)}>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={onToggle}
            className="absolute inset-0 z-0 w-full cursor-pointer rounded-none border-0 bg-transparent transition-colors duration-150 hover:bg-[color-mix(in_oklab,var(--sunken)_70%,transparent)] focus-visible:outline-2 focus-visible:outline-brand"
          >
            <span className="sr-only">
              {view.name} 자세히 {open ? "닫기" : "보기"}
            </span>
          </button>
          {/* Name + status (mobile: one line with the chevron) */}
          <div className="pointer-events-none relative flex min-w-0 items-center gap-3">
            <SourceTile icon={view.id} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm leading-5 font-semibold">{view.name}</span>
              <span
                className={cn(
                  "truncate text-xs leading-4",
                  sub.tone === "gain"
                    ? "text-gain"
                    : sub.tone === "warn"
                      ? "text-warn"
                      : "text-ink-3"
                )}
              >
                {sub.text}
              </span>
            </span>
            <span className="lg:hidden">
              <StatusBadge status={view.status} />
            </span>
            <span className="lg:hidden" aria-hidden="true">
              <Chevron className={open ? "rotate-180" : undefined} />
            </span>
          </div>
          <span className="pointer-events-none relative hidden lg:block">
            <StatusBadge status={view.status} />
          </span>
          <span
            className="pointer-events-none relative hidden text-[13px] text-ink-2 lg:block"
            title={last ? formatDateTime(last, { now }) : undefined}
          >
            {last ? formatRelative(last, now) : "없음"}
          </span>
          <div className="relative mt-3 pl-11 lg:mt-0 lg:pl-0">
            <RowEvidenceStrip
              cells={view.cells}
              label={view.name}
              unit={unit}
              hovered={hoverIndex}
              onHover={onHover}
              className="relative z-[1]"
            />
            {tooltip}
          </div>
          <span
            className={cn(
              "num pointer-events-none relative hidden text-right text-[15px] font-medium lg:block",
              view.total > 0 ? "text-ink" : "text-ink-3"
            )}
          >
            {total}
          </span>
          <span
            className="pointer-events-none relative hidden place-items-center lg:grid"
            aria-hidden="true"
          >
            <Chevron className={open ? "rotate-180" : undefined} />
          </span>
          <p className="pointer-events-none relative m-0 mt-2.5 pl-11 text-xs leading-4 text-ink-3 lg:hidden">
            마지막 성공 {last ? formatRelative(last, now) : "없음"} · {view.cells.length}일 합계{" "}
            <span className="num text-ink-2">{total}</span>
          </p>
        </div>
        {fact ? (
          <div className="-mt-1 pb-3.5 pl-11">
            <AiLine fact={fact} className="max-w-[760px]" />
          </div>
        ) : null}
      </EvidenceScope>
      <Disclosure open={open} id={panelId}>
        <div className="grid gap-4 pb-5 pl-11 lg:grid-cols-[minmax(0,560px)_auto] lg:justify-between lg:gap-8 xl:pl-[252px]">
          <div className="flex flex-col gap-2">
            <p className="m-0 text-sm leading-[22px] text-ink-2">{view.source.recoveryHelp}</p>
            <span className="text-xs leading-4 text-ink-3">
              마지막 성공 {last ? formatDateTime(last, { now }) : "확인된 이력 없음"}
              {lastRecord
                ? ` · 마지막 기록 ${formatDateTime(lastRecord, { now })}`
                : " · 이 기간 기록 없음"}
            </span>
            {jobs.length > 0 ? (
              <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0 text-xs leading-[18px] text-ink-2">
                {jobs.slice(0, 3).map((job) => (
                  <li key={job.id}>
                    재수집 {formatDateRange(job.fromDate, job.toDate, { now })} ·{" "}
                    {job.status === "completed"
                      ? "완료"
                      : job.status === "failed"
                        ? `${formatMonthDay(job.nextDate, { now })} 처리 실패`
                        : `${formatMonthDay(job.nextDate, { now })}부터 ${job.status === "running" ? "처리 중" : "대기 중"}`}
                    {job.error ? <span className="text-gain"> · {job.error}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="flex items-start gap-2 lg:justify-end">
            {view.source.canRecover ? (
              <Button variant="outline" size="sm" disabled={busy} onClick={onRecover}>
                {busy
                  ? "재수집 진행 중"
                  : view.status === "ok" && view.gaps.length > 0
                    ? `${formatDateRange(r.from, r.to, { now })} 재수집`
                    : `${view.name} 재수집`}
              </Button>
            ) : link ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={link.href}>{link.label}</Link>
              </Button>
            ) : null}
          </div>
        </div>
      </Disclosure>
    </li>
  );
}

function CellTooltip({
  views,
  index,
  rowId,
  now,
}: {
  views: SourceView[];
  index: number;
  rowId: SourceId;
  now: Date;
}) {
  const row = views.find((v) => v.id === rowId);
  const cell = row?.cells[index];
  if (!row || !cell) return null;
  const pos = (index + 0.5) / row.cells.length;
  const translate = pos > 0.7 ? "-90%" : pos < 0.25 ? "-10%" : "-50%";
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-[34px] z-30 min-w-[220px] rounded-[10px] bg-surface px-3 py-2.5 text-xs leading-[18px] whitespace-nowrap text-ink shadow-tip"
      style={{ left: `${pos * 100}%`, translate: `${translate} 0` }}
    >
      <span className="mb-1.5 block text-[13px] font-semibold">
        {formatMonthDay(cell.date, { now })}
        {cell.isToday ? " · 오늘" : ""}
      </span>
      {sortBySeverity(views).map((v) => {
        const c = v.cells[index];
        if (!c) return null;
        const tone =
          c.kind === "fail"
            ? "text-gain"
            : c.kind === "gap"
              ? "text-warn"
              : c.count === 0
                ? "text-ink-3"
                : "text-ink";
        return (
          <span
            key={v.id}
            className={cn("flex justify-between gap-5", tone, v.id === rowId && "font-semibold")}
          >
            <span>{v.name}</span>
            <span className="num">{cellText(c, SOURCE_NAMES[v.id].unit)}</span>
          </span>
        );
      })}
    </span>
  );
}
