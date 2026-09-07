"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Header } from "@/components/Layout/Header";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { dateKeyToUtcMillis, shiftDateKey, toKstCalendarDate } from "@/lib/date-key";
import { useRequireAuth } from "@/modules/auth/hooks";
import type { SearchResponse, SearchSource } from "@/modules/search/types";

const SOURCE_LABELS: Record<SearchSource, string> = {
  all: "전체 기록",
  commit: "커밋",
  spending: "거래",
  visit: "장소 방문",
  trip: "여행",
};

type Filters = { q: string; from: string; to: string; source: string };

function readFilters(params: URLSearchParams, today: string): Filters {
  const to = params.get("to") ?? today;
  return {
    q: params.get("q") ?? "",
    from: params.get("from") ?? shiftDateKey(dateKeyToUtcMillis(to) === null ? today : to, -29),
    to,
    source: params.get("source") ?? "all",
  };
}

function validFilters(filters: Filters) {
  const start = dateKeyToUtcMillis(filters.from);
  const end = dateKeyToUtcMillis(filters.to);
  return (
    start !== null &&
    end !== null &&
    end >= start &&
    end - start < 366 * 86_400_000 &&
    filters.q.trim().length <= 200 &&
    Object.hasOwn(SOURCE_LABELS, filters.source)
  );
}

function SearchResults({
  data,
  page,
  busy,
  onPage,
}: {
  data: SearchResponse;
  page: number;
  busy: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <>
      {data.items.length === 0 ? (
        <p className="rounded-xl border p-6 text-sm text-muted-foreground">
          조건에 맞는 기록이 없습니다. 검색어나 기간을 바꿔보세요.
        </p>
      ) : (
        <ul className="space-y-3">
          {data.items.map((item) => (
            <li key={`${item.source}:${item.id}`}>
              <Link
                href={item.href}
                prefetch={false}
                className="block rounded-xl border bg-card p-4 space-y-2 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded bg-muted px-2 py-1">{SOURCE_LABELS[item.source]}</span>
                  <time dateTime={item.date}>{item.date}</time>
                </div>
                <h3 className="font-medium break-words">{item.title}</h3>
                {item.description && (
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
                    {item.description}
                  </p>
                )}
                <span className="block text-xs text-muted-foreground">기록 보기 →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <nav aria-label="검색 결과 페이지" className="flex items-center justify-between gap-3">
        <Button variant="outline" disabled={page <= 1 || busy} onClick={() => onPage(page - 1)}>
          이전
        </Button>
        <span className="text-sm">{page}페이지</span>
        <Button
          variant="outline"
          disabled={!data.hasMore || page >= 100 || busy}
          onClick={() => onPage(page + 1)}
        >
          다음
        </Button>
      </nav>
      {page >= 100 && (
        <p className="text-sm text-muted-foreground">
          더 많은 기록을 찾으려면 기간이나 검색어를 좁혀 주세요.
        </p>
      )}
    </>
  );
}

function SearchView({ params }: { params: URLSearchParams }) {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useRequireAuth();
  const { data: session } = useSession();
  const [today] = useState(() => toKstCalendarDate(new Date()));
  const applied = readFilters(params, today);
  const pageText = params.get("page") ?? "1";
  const page = Number(pageText);
  const validPage = /^\d+$/.test(pageText) && page >= 1 && page <= 100;
  const [draft, setDraft] = useState(applied);
  const valid = validFilters(draft);
  const appliedValid = validFilters(applied) && validPage;
  const changed = (Object.keys(draft) as (keyof Filters)[]).some(
    (key) => draft[key] !== applied[key]
  );
  const request = new URLSearchParams({ ...applied, page: String(page) }).toString();
  const query = useQuery<SearchResponse>({
    queryKey: ["record-search", session?.session.id, request],
    enabled: isAuthenticated && appliedValid,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/search?${request}`, { signal });
      if (!response.ok) throw new Error("기록을 검색하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return response.json();
    },
  });
  function navigate(filters: Filters, nextPage: number) {
    const target = new URLSearchParams({
      ...filters,
      q: filters.q.trim(),
      page: String(nextPage),
    });
    if (target.toString() === request) void query.refetch();
    else router.push(`/search?${target}`, { scroll: false });
  }

  if (isLoading) return <p className="p-8">로그인 확인 중…</p>;
  if (!isAuthenticated) return null;
  return (
    <div className="min-h-screen bg-background">
      <Header showSync={false} />
      <main className="container mx-auto max-w-4xl p-4 py-6 space-y-5">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">기록 검색</h1>
          <p className="text-sm text-muted-foreground">
            커밋, 거래, 장소 방문과 여행을 함께 찾아보세요. 날짜는 한국 시간 기준입니다.
          </p>
        </div>
        <form
          aria-label="기록 검색 조건"
          className="rounded-xl border bg-card p-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            navigate(draft, 1);
          }}
        >
          <label className="block space-y-1 text-sm">
            검색어
            <input
              type="search"
              className="block w-full min-w-0 rounded border bg-background p-2"
              placeholder="커밋 메시지, 가맹점, 장소, 여행 이름"
              maxLength={200}
              value={draft.q}
              onChange={(event) => setDraft({ ...draft, q: event.target.value })}
            />
          </label>
          <div className="grid grid-cols-1 min-[400px]:grid-cols-2 sm:grid-cols-4 gap-3 items-end">
            <label className="min-w-0 space-y-1 text-sm">
              시작일
              <input
                className="block w-full min-w-0 rounded border bg-background p-2"
                type="date"
                required
                value={draft.from}
                onChange={(event) => setDraft({ ...draft, from: event.target.value })}
              />
            </label>
            <label className="min-w-0 space-y-1 text-sm">
              종료일
              <input
                className="block w-full min-w-0 rounded border bg-background p-2"
                type="date"
                required
                value={draft.to}
                onChange={(event) => setDraft({ ...draft, to: event.target.value })}
              />
            </label>
            <label className="min-w-0 space-y-1 text-sm">
              기록 종류
              <select
                aria-label="기록 종류"
                className="block w-full min-w-0 rounded border bg-background p-2"
                value={draft.source}
                onChange={(event) => setDraft({ ...draft, source: event.target.value })}
              >
                {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={!valid}>
              검색
            </Button>
          </div>
          {!valid && (
            <p role="alert" className="text-sm text-destructive">
              최대 366일의 유효한 기간과 기록 종류를 선택해 주세요. 검색어는 200자까지입니다.
            </p>
          )}
        </form>
        {changed && (
          <p role="status" className="text-sm text-muted-foreground">
            검색 버튼을 누르면 변경한 조건이 적용됩니다. 아래는 이전 검색 결과입니다.
          </p>
        )}
        {!appliedValid && (
          <p role="alert" className="text-sm text-destructive">
            검색 주소의 조건이 올바르지 않습니다. 조건을 수정한 뒤 검색해 주세요.
          </p>
        )}
        {appliedValid && (
          <section aria-label="검색 결과" aria-busy={query.isFetching} className="space-y-3">
            <h2 className="text-sm font-medium break-words">
              {applied.from} ~ {applied.to} · {SOURCE_LABELS[applied.source as SearchSource]}
              {applied.q && ` · “${applied.q}”`}
            </h2>
            {query.isFetching && <p role="status">기록을 검색하는 중…</p>}
            {query.isError ? (
              <div role="alert" className="rounded-xl border p-4 space-y-3">
                <p className="text-sm text-destructive">{query.error.message}</p>
                <Button
                  variant="outline"
                  onClick={() => query.refetch()}
                  disabled={query.isFetching}
                >
                  다시 시도
                </Button>
              </div>
            ) : query.data ? (
              <SearchResults
                data={query.data}
                page={page}
                busy={query.isFetching || changed}
                onPage={(nextPage) => navigate(applied, nextPage)}
              />
            ) : null}
          </section>
        )}
      </main>
    </div>
  );
}

function SearchFromUrl() {
  const params = useSearchParams();
  // A history change restores the form and query together; unsubmitted edits stay local.
  return <SearchView key={params.toString()} params={new URLSearchParams(params.toString())} />;
}

export default function SearchPage() {
  return (
    <Suspense fallback={<p className="p-8">검색 화면을 불러오는 중…</p>}>
      <SearchFromUrl />
    </Suspense>
  );
}
