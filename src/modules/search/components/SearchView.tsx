"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { AiLine, EmptyState, ErrorState, LoadingState, PageTitle } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSession } from "@/lib/auth-client";
import { dateKeyToUtcMillis, shiftDateKey, toKstCalendarDate } from "@/lib/date-key";
import { diagnosis } from "@/lib/facts/helpers";
import type { Fact } from "@/lib/facts/types";
import { formatCount, formatDateRange, formatDay, formatTime, formatWon } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Chevron, Disclosure, SourceTile } from "@/modules/data-status/components/SourceIcon";
import { EXPENSE_CATEGORY_LABELS, isExpenseCategory } from "@/modules/spending/categories";
import {
  type CommitGroup,
  commitGroupFact,
  groupByDay,
  type ItemRow,
  splitCommitTitle,
} from "../grouping";
import { parseNaturalQuery, type RecordSource, SOURCE_LABELS } from "../nl-parser";
import type { SearchItem, SearchResponse, SearchSource } from "../types";

// ── URL state ───────────────────────────────────────────────────────────────

interface Applied {
  text: string;
  q: string;
  from: string;
  to: string;
  source: SearchSource;
  only: RecordSource[];
  category: string;
  hours: string;
}

const RECORD_SOURCES: RecordSource[] = ["commit", "spending", "visit", "trip"];
const SOURCES = new Set<string>(["all", ...RECORD_SOURCES]);

function readApplied(params: URLSearchParams, today: string): Applied {
  const to = params.get("to") ?? today;
  return {
    text: params.get("text") ?? "",
    q: params.get("q") ?? "",
    from: params.get("from") ?? shiftDateKey(dateKeyToUtcMillis(to) === null ? today : to, -29),
    to,
    source: (params.get("source") ?? "all") as SearchSource,
    only: (params.get("only") ?? "")
      .split(",")
      .filter((s): s is RecordSource => RECORD_SOURCES.includes(s as RecordSource)),
    category: params.get("category") ?? "",
    hours: params.get("hours") ?? "",
  };
}

function rangeError(from: string, to: string): boolean {
  const start = dateKeyToUtcMillis(from);
  const end = dateKeyToUtcMillis(to);
  return start === null || end === null || end < start || end - start >= 366 * 86_400_000;
}

function validApplied(a: Applied, pageText: string | null): boolean {
  if (pageText !== null && !/^([1-9]\d?|100)$/.test(pageText)) return false;
  return (
    !rangeError(a.from, a.to) &&
    a.q.length <= 200 &&
    SOURCES.has(a.source) &&
    (!a.category || isExpenseCategory(a.category)) &&
    (!a.hours || /^\d{1,2}-\d{1,2}$/.test(a.hours))
  );
}

function toUrl(a: Applied): string {
  const p = new URLSearchParams();
  if (a.text) p.set("text", a.text);
  p.set("q", a.q);
  p.set("from", a.from);
  p.set("to", a.to);
  p.set("source", a.source);
  if (a.only.length) p.set("only", a.only.join(","));
  if (a.category) p.set("category", a.category);
  if (a.hours) p.set("hours", a.hours);
  return `/search?${p}`;
}

const PRESETS = [
  { days: 1, label: "오늘" },
  { days: 7, label: "7일" },
  { days: 30, label: "30일" },
  { days: 90, label: "90일" },
  { days: 366, label: "1년" },
];

function rangeLabel(a: Applied, today: string, parsedLabel: string | null): string {
  if (parsedLabel) return parsedLabel;
  if (a.to === today) {
    for (const preset of PRESETS) {
      if (a.from === shiftDateKey(today, -(preset.days - 1))) {
        return preset.days === 1
          ? "오늘"
          : `최근 ${preset.days === 366 ? "1년" : `${preset.days}일`}`;
      }
    }
  }
  return formatDateRange(a.from, a.to);
}

function hoursLabel(hours: string): string {
  const [from, to] = hours.split("-").map(Number);
  return `${from}–${to}시`;
}

// ── Recent searches (per-viewer convenience) ────────────────────────────────

const RECENT_KEY = "cistory.search.recent";
function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((s) => typeof s === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}
function saveRecent(text: string) {
  try {
    const next = [text, ...loadRecent().filter((s) => s !== text)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode): recent searches are optional.
  }
}

// ── Icons ───────────────────────────────────────────────────────────────────

const ICON_FOR: Record<RecordSource, Parameters<typeof SourceTile>[0]["icon"]> = {
  commit: "github",
  spending: "card",
  visit: "location",
  trip: "trip",
};
const DOT_FOR: Record<RecordSource, string> = {
  commit: "var(--brand)",
  spending: "var(--ink2)",
  visit: "var(--place)",
  trip: "var(--health)",
};

function XIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

const CHIP =
  "inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-sunken px-2.5 text-[13px] font-medium whitespace-nowrap text-ink shadow-[inset_0_0_0_1px_var(--line)] transition-[scale,box-shadow] duration-150 ease-out active:scale-[0.96] hover:shadow-[inset_0_0_0_1px_var(--ink3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

// ── View ────────────────────────────────────────────────────────────────────

export function SearchView({ params, enabled }: { params: URLSearchParams; enabled: boolean }) {
  const router = useRouter();
  const { data: session } = useSession();
  const [today] = useState(() => toKstCalendarDate(new Date()));
  const applied = readApplied(params, today);
  const valid = validApplied(applied, params.get("page"));
  const parsedFromText = applied.text ? parseNaturalQuery(applied.text, today) : null;
  const [text, setText] = useState(applied.text || applied.q);
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent(loadRecent()), []);

  const api = new URLSearchParams({
    q: applied.q,
    from: applied.from,
    to: applied.to,
    source: applied.source,
  });
  if (applied.category) api.set("category", applied.category);
  if (applied.hours) api.set("hours", applied.hours);
  const request = api.toString();

  const query = useInfiniteQuery<SearchResponse>({
    queryKey: ["record-search", session?.session.id, request],
    enabled: enabled && valid,
    retry: false,
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore && last.page < 100 ? last.page + 1 : undefined),
    queryFn: async ({ signal, pageParam }) => {
      const response = await fetch(`/api/search?${request}&page=${pageParam}`, { signal });
      if (!response.ok) throw new Error("기록을 검색하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return response.json();
    },
  });

  const go = (next: Applied) => {
    const url = toUrl(next);
    if (valid && url === toUrl(applied)) void query.refetch();
    else router.push(url, { scroll: false });
  };

  const submit = () => {
    const raw = text.trim().slice(0, 200);
    const parsed = parseNaturalQuery(raw, today);
    if (raw) {
      saveRecent(raw);
      setRecent(loadRecent());
    }
    const recognised = parsed.range || parsed.sources.length || parsed.category || parsed.hours;
    go({
      text: recognised ? raw : "",
      q: parsed.q.slice(0, 200),
      from: parsed.range?.from ?? applied.from,
      to: parsed.range?.to ?? applied.to,
      source: parsed.sources.length === 1 ? parsed.sources[0] : "all",
      only: parsed.sources.length > 1 ? parsed.sources : [],
      category: parsed.category ?? "",
      hours: parsed.hours ? `${parsed.hours.from}-${parsed.hours.to}` : "",
    });
  };

  const pages = query.data?.pages ?? [];
  const counts = pages[0]?.counts;
  const items = useMemo(() => {
    const all = pages.flatMap((p) => p.items);
    return applied.only.length ? all.filter((i) => applied.only.includes(i.source)) : all;
  }, [pages, applied.only]);
  const days = useMemo(() => groupByDay(items), [items]);
  const hasMore = !!query.hasNextPage;
  const label = rangeLabel(applied, today, parsedFromText?.range?.label ?? null);
  const textChanged = text.trim() !== (applied.text || applied.q);

  const segCount = (s: RecordSource) =>
    counts && (!applied.only.length || applied.only.includes(s)) ? counts[s] : 0;
  const totalCount = counts ? RECORD_SOURCES.reduce((sum, s) => sum + segCount(s), 0) : null;

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col">
      <PageTitle
        title="기록 검색"
        meta="커밋 · 소비 · 방문 · 여행을 한 번에 찾아요. 말하듯 적어도 돼요."
        className="mb-6 max-sm:sr-only"
      />
      <div className="ds-enter flex flex-col gap-3">
        <form
          aria-label="기록 검색"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="surface flex h-[52px] w-full cursor-text items-center gap-2.5 pr-1.5 pl-3.5 focus-within:shadow-[var(--elev-ring-hover),0_0_0_2px_var(--brand)]">
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--ink3)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="flex-none"
            >
              <path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3" />
            </svg>
            <input
              type="search"
              aria-label="검색어"
              aria-describedby="search-hint"
              maxLength={200}
              placeholder="무엇을 찾을까요 — 예: 지난주 저녁 배달"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="h-10 min-w-0 flex-1 border-0 bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
            />
            <span id="search-hint" className="sr-only">
              날짜, 기록 종류, 소비 분류, 시간대는 알아서 조건으로 바꿔요. Enter로 검색합니다.
            </span>
            {recent.length > 0 ? (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="최근 검색"
                    className="grid size-9 flex-none cursor-pointer place-items-center rounded-[9px] border-0 bg-transparent text-ink-2 hover:bg-track hover:text-ink"
                  >
                    <svg
                      aria-hidden="true"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 8v4l3 2M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
                    </svg>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 p-1.5">
                  <span className="block px-2 pt-1 pb-1.5 text-xs text-ink-3">최근 검색</span>
                  {recent.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setText(r)}
                      className="block w-full cursor-pointer truncate rounded-md border-0 bg-transparent px-2 py-2 text-left text-sm text-ink hover:bg-track"
                    >
                      {r}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            ) : null}
            <Button
              type="submit"
              size="sm"
              className={cn(!textChanged && "max-sm:sr-only")}
              disabled={text.trim().length > 200}
            >
              검색
            </Button>
          </label>
        </form>

        <div className="flex flex-wrap items-center gap-1.5">
          <RangeChip
            applied={applied}
            label={label}
            today={today}
            onApply={(from, to) => go({ ...applied, text: "", from, to })}
          />
          {applied.only.map((s) => (
            <button
              key={s}
              type="button"
              className={CHIP}
              aria-label={`출처 ${SOURCE_LABELS[s]} 조건 지우기`}
              onClick={() =>
                go({ ...applied, text: "", only: applied.only.filter((x) => x !== s) })
              }
            >
              <small className="text-[11px] font-medium text-ink-3">출처</small>
              {SOURCE_LABELS[s]}
              <XIcon />
            </button>
          ))}
          {applied.category && isExpenseCategory(applied.category) ? (
            <button
              type="button"
              className={CHIP}
              aria-label={`분류 ${EXPENSE_CATEGORY_LABELS[applied.category]} 조건 지우기`}
              onClick={() => go({ ...applied, text: "", category: "" })}
            >
              <small className="text-[11px] font-medium text-ink-3">분류</small>
              {EXPENSE_CATEGORY_LABELS[applied.category]}
              <XIcon />
            </button>
          ) : null}
          {applied.hours ? (
            <button
              type="button"
              className={CHIP}
              aria-label="시간대 조건 지우기"
              onClick={() => go({ ...applied, text: "", hours: "" })}
            >
              <small className="text-[11px] font-medium text-ink-3">시간</small>
              {parsedFromText?.hours?.label ?? hoursLabel(applied.hours)}
              <XIcon />
            </button>
          ) : null}
          {applied.q && applied.text ? (
            <button
              type="button"
              className={CHIP}
              aria-label={`검색어 ${applied.q} 지우기`}
              onClick={() => {
                setText("");
                go({ ...applied, text: "", q: "" });
              }}
            >
              <small className="text-[11px] font-medium text-ink-3">검색어</small>
              {applied.q}
              <XIcon />
            </button>
          ) : null}
        </div>

        <QueryAiLine items={items} label={label} done={!hasMore && query.isSuccess} />

        <SourceSegment
          value={applied.source}
          counts={counts ? { all: totalCount ?? 0, ...counts } : null}
          segCount={segCount}
          onChange={(source) => go({ ...applied, source })}
        />
      </div>

      {!valid ? (
        <p role="alert" className="mt-6 text-sm text-gain">
          검색 주소의 조건이 올바르지 않습니다. 기간을 다시 골라 검색해 주세요.
        </p>
      ) : (
        <section
          aria-label="검색 결과"
          aria-busy={query.isFetching}
          className="ds-enter mt-1 [animation-delay:100ms]"
        >
          {query.isError ? (
            <ErrorState
              className="mt-8"
              title={query.error.message}
              actions={
                <Button
                  variant="outline"
                  onClick={() => query.refetch()}
                  disabled={query.isFetching}
                >
                  다시 시도
                </Button>
              }
            />
          ) : query.isPending ? (
            <LoadingState variant="rows" rows={6} className="mt-6" label="기록을 검색하는 중" />
          ) : days.length === 0 ? (
            <EmptyState
              className="mt-8"
              title="이 조건에 맞는 기록이 없어요"
              description="검색어를 줄이거나 기간을 넓혀 보세요."
            />
          ) : (
            <>
              {days.map((day, i) => (
                <div key={day.date}>
                  <div className="flex items-baseline justify-between border-b border-line pt-5 pb-2">
                    <h2 className="m-0 text-[15px] font-semibold">
                      <time dateTime={day.date}>{formatDay(day.date)}</time>
                    </h2>
                    <span className="text-xs text-ink-3">
                      <span className="num">{formatCount(day.total)}</span>건
                      {i === days.length - 1 && hasMore ? " · 이어서 더 있음" : ""}
                    </span>
                  </div>
                  <ul className="m-0 list-none p-0">
                    {day.rows.map((row) =>
                      row.kind === "commits" ? (
                        <CommitGroupRow key={row.key} group={row} />
                      ) : (
                        <ResultRow key={row.key} row={row} />
                      )
                    )}
                  </ul>
                </div>
              ))}
              {hasMore ? (
                <Button
                  variant="outline"
                  className="mt-5 h-11 w-full"
                  disabled={query.isFetchingNextPage}
                  onClick={() => query.fetchNextPage()}
                >
                  {query.isFetchingNextPage ? "불러오는 중" : "더 보기"}
                </Button>
              ) : pages.length >= 100 ? (
                <p className="mt-5 text-sm text-ink-3">
                  더 많은 기록을 찾으려면 기간이나 검색어를 좁혀 주세요.
                </p>
              ) : null}
            </>
          )}
        </section>
      )}
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function RangeChip({
  applied,
  label,
  today,
  onApply,
}: {
  applied: Applied;
  label: string;
  today: string;
  onApply: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState(applied.from);
  const [to, setTo] = useState(applied.to);
  const invalid = rangeError(from, to);
  const presetIndex = PRESETS.findIndex(
    (p) => applied.to === today && applied.from === shiftDateKey(today, -(p.days - 1))
  );
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setFrom(applied.from);
          setTo(applied.to);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className={CHIP} aria-label={`기간 ${label} 바꾸기`}>
          <small className="text-[11px] font-medium text-ink-3">기간</small>
          {label}
          <Chevron className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-[300px] flex-col gap-2.5 p-3.5">
        <fieldset
          aria-label="기간 고르기"
          className="relative m-0 grid h-9 grid-cols-5 rounded-lg border-0 bg-track p-[3px]"
        >
          {presetIndex >= 0 ? (
            <span
              aria-hidden="true"
              className="ds-seg-thumb absolute top-[3px] left-[3px] h-[30px] rounded-[7px] bg-surface shadow-ring"
              style={{ width: "calc((100% - 6px) / 5)", translate: `${presetIndex * 100}% 0` }}
            />
          ) : null}
          {PRESETS.map((p, i) => (
            <button
              key={p.label}
              type="button"
              aria-pressed={i === presetIndex}
              onClick={() => {
                setOpen(false);
                onApply(shiftDateKey(today, -(p.days - 1)), today);
              }}
              className={cn(
                "relative z-[1] h-[30px] cursor-pointer rounded-[7px] border-0 bg-transparent text-[13px]",
                i === presetIndex ? "font-semibold text-ink" : "font-medium text-ink-2"
              )}
            >
              {p.label}
            </button>
          ))}
        </fieldset>
        <span className="num text-[13px] text-ink-2">
          {formatDateRange(applied.from, applied.to)}
        </span>
        {custom ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (invalid) return;
              setOpen(false);
              onApply(from, to);
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-xs text-ink-3">
                시작일
                <input
                  type="date"
                  required
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-3">
                종료일
                <input
                  type="date"
                  required
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
                />
              </label>
            </div>
            {invalid ? (
              <p role="alert" className="m-0 text-xs text-gain">
                최대 366일의 유효한 기간을 골라 주세요.
              </p>
            ) : null}
            <Button type="submit" size="sm" disabled={invalid} className="self-start">
              이 기간으로 검색
            </Button>
          </form>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setCustom(true)}
          >
            날짜 직접 고르기
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function SourceSegment({
  value,
  counts,
  segCount,
  onChange,
}: {
  value: SearchSource;
  counts: Record<SearchSource, number> | null;
  segCount: (s: RecordSource) => number;
  onChange: (value: SearchSource) => void;
}) {
  const items: { value: SearchSource; label: string }[] = [
    { value: "all", label: "전체" },
    ...RECORD_SOURCES.map((s) => ({ value: s as SearchSource, label: SOURCE_LABELS[s] })),
  ];
  const index = Math.max(
    0,
    items.findIndex((i) => i.value === value)
  );
  return (
    <fieldset
      aria-label="기록 종류"
      className="relative m-0 mt-1 grid h-9 w-full min-w-0 grid-cols-5 rounded-[10px] border-0 bg-track p-[3px]"
    >
      <span
        aria-hidden="true"
        className="ds-seg-thumb absolute top-[3px] left-[3px] h-[30px] rounded-[7px] bg-surface shadow-ring"
        style={{ width: "calc((100% - 6px) / 5)", translate: `${index * 100}% 0` } as CSSProperties}
      />
      {items.map((item) => {
        const on = item.value === value;
        const n = counts
          ? item.value === "all"
            ? counts.all
            : segCount(item.value as RecordSource)
          : null;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(item.value)}
            className={cn(
              "relative z-[1] inline-flex h-[30px] min-w-0 cursor-pointer items-center justify-center gap-1 rounded-[7px] border-0 bg-transparent px-1 text-[13px] whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-brand",
              on
                ? "font-semibold text-ink"
                : n === 0
                  ? "font-medium text-ink-3"
                  : "font-medium text-ink-2"
            )}
          >
            {item.label}
            {n !== null ? (
              <span className="num text-[11px] font-normal text-ink-3">{n > 999 ? "999+" : n}</span>
            ) : null}
          </button>
        );
      })}
    </fieldset>
  );
}

function QueryAiLine({
  items,
  label,
  done,
}: {
  items: SearchItem[];
  label: string;
  done: boolean;
}) {
  const fact = useMemo<Fact | null>(() => {
    const spend = items.filter((i) => i.source === "spending" && typeof i.amount === "number");
    if (!done || spend.length < 2) return null;
    const sum = spend.reduce((s, i) => s + (i.amount ?? 0), 0);
    const top = [...spend].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).slice(0, 4);
    return diagnosis({
      id: "search.spending.sum",
      metric: "spending",
      metricLabel: "소비",
      period: { from: "", to: "", label },
      value: sum,
      unit: "won",
      template: "{range} 찾은 소비는 {n}건, 모두 {fact}이에요.",
      detail: { range: label, n: spend.length },
      rows: top.map((i) => ({
        label: i.title,
        value: `${formatWon(i.amount ?? 0)}${i.category && isExpenseCategory(i.category) ? ` · ${EXPENSE_CATEGORY_LABELS[i.category]}` : ""}`,
      })),
    });
  }, [items, label, done]);
  return <AiLine fact={fact} />;
}

function itemMeta(item: SearchItem): string {
  if (item.source === "spending") {
    return `소비${item.category && isExpenseCategory(item.category) ? ` · ${EXPENSE_CATEGORY_LABELS[item.category]}` : ""}`;
  }
  if (item.source === "visit") return `방문${item.description ? ` · ${item.description}` : ""}`;
  if (item.source === "trip") return `여행${item.description ? ` · ${item.description}` : ""}`;
  return `커밋 · ${item.repository ?? item.description}`;
}

function ResultRow({ row }: { row: ItemRow }) {
  const { item } = row;
  const right =
    item.source === "spending" && typeof item.amount === "number"
      ? formatWon(item.amount)
      : item.source === "visit" && row.repeat > 1
        ? `${row.repeat}번`
        : item.occurredAt && item.source === "commit"
          ? formatTime(new Date(item.occurredAt))
          : "";
  return (
    <li className="border-b border-line">
      <a
        href={item.href}
        className="flex items-start gap-3 py-3 text-ink no-underline transition-colors duration-150 hover:bg-[color-mix(in_oklab,var(--sunken)_70%,transparent)] focus-visible:outline-2 focus-visible:outline-brand"
      >
        <SourceTile icon={ICON_FOR[item.source]} dot={DOT_FOR[item.source]} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="m-0 text-[15px] leading-[22px] font-semibold break-words">{item.title}</h3>
          <span className="truncate text-[13px] leading-[18px] text-ink-3">{itemMeta(item)}</span>
        </span>
        {right ? (
          <span
            className={cn(
              "num text-[15px] leading-[22px] whitespace-nowrap",
              item.source === "spending" || item.source === "visit"
                ? "font-medium text-ink"
                : "text-[13px] text-ink-3"
            )}
          >
            {right}
          </span>
        ) : null}
      </a>
    </li>
  );
}

function CommitGroupRow({ group }: { group: CommitGroup }) {
  const [open, setOpen] = useState(false);
  const fact = commitGroupFact(group);
  const id = `group-${group.key.replace(/[^\w-]/g, "_")}`;
  return (
    <li className="border-b border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-start gap-3 border-0 bg-transparent py-3 text-left text-ink transition-colors duration-150 hover:bg-[color-mix(in_oklab,var(--sunken)_70%,transparent)] focus-visible:outline-2 focus-visible:outline-brand"
      >
        <SourceTile icon="github" dot={DOT_FOR.commit} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="m-0 text-[15px] leading-[22px] font-semibold">
            {group.name} 커밋 <span className="num">{group.items.length}</span>건
          </h3>
          <span className="truncate text-[13px] leading-[18px] text-ink-3">
            {[group.owner, group.ticket].filter(Boolean).join(" · ") || group.repository}
          </span>
        </span>
        <Chevron className="mt-1" />
      </button>
      {fact ? (
        <div className="-mt-1.5 pb-3 pl-11">
          <AiLine fact={fact} />
        </div>
      ) : null}
      <Disclosure open={open} id={id}>
        <ul className="m-0 flex list-none flex-col p-0 pb-2 pl-11">
          {group.items.map((item) => {
            const { tag, body } = splitCommitTitle(item.title);
            return (
              <li key={item.id} className="border-t border-line">
                <a
                  href={item.href}
                  className="flex flex-col gap-0.5 py-2 text-ink no-underline hover:text-brand focus-visible:outline-2 focus-visible:outline-brand"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="num text-[11px] leading-4 text-ink-3">{tag}</span>
                    {item.occurredAt ? (
                      <span className="num text-[11px] leading-4 text-ink-3">
                        {formatTime(new Date(item.occurredAt))}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-sm leading-[21px]" title={item.title}>
                    {body}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </Disclosure>
    </li>
  );
}
