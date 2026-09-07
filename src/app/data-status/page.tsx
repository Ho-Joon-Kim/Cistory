"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Header } from "@/components/Layout/Header";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { shiftDateKey, toKstCalendarDate } from "@/lib/date-key";
import { useRequireAuth } from "@/modules/auth/hooks";
import { validateStatusRange } from "@/modules/data-status/model";
import type { DataStatusResponse, DayState, SourceStatus } from "@/modules/data-status/types";

const STATES: Record<DayState, { label: string; color: string }> = {
  observed: { label: "기록 있음", color: "bg-emerald-600 text-white" },
  unknown: { label: "기록 없음 · 수집 여부 미확인", color: "bg-muted text-muted-foreground" },
  checked: { label: "재조회 완료 · 기록 없음", color: "bg-sky-100 text-sky-900" },
  failed: { label: "재조회 실패", color: "bg-red-100 text-red-900" },
  pending: { label: "재조회 대기·진행", color: "bg-amber-100 text-amber-900" },
};
const timestamp = (value: string | null) =>
  value ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "확인된 이력 없음";

function SourceCard({
  source,
  busy,
  onRecover,
}: {
  source: SourceStatus;
  busy: boolean;
  onRecover: () => void;
}) {
  return (
    <section className="rounded-xl border bg-card p-4 space-y-3 min-w-0">
      <div className="flex flex-wrap justify-between gap-2">
        <h2 className="font-semibold">{source.label}</h2>
        <span className="text-sm text-muted-foreground">
          {source.needsReauth ? "재인증 필요" : source.connected ? "연결됨" : "연결 안 됨"}
        </span>
      </div>
      <div className="text-xs text-muted-foreground space-y-1">
        <p>최근 동기화 성공: {timestamp(source.lastSuccessAt)}</p>
        <p>선택 기간 마지막 기록: {timestamp(source.lastRecordAt)}</p>
      </div>
      {source.stale && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          48시간 이상 동기화 성공 이력이 없습니다.
        </p>
      )}
      {source.error && <p className="text-sm text-destructive">{source.error}</p>}
      <ul className="grid grid-cols-7 gap-1" aria-label={`${source.label} 날짜별 기록`}>
        {source.days.map((day) => (
          <li
            key={day.date}
            className={`rounded p-1.5 text-center text-xs ${STATES[day.state].color}`}
            title={`${day.date}: ${STATES[day.state].label}, ${day.count}건`}
          >
            <span className="sr-only">
              {day.date}: {STATES[day.state].label},{" "}
            </span>
            <span aria-hidden="true" className="whitespace-nowrap text-[10px]">
              {day.date.slice(5)}
            </span>
            <span className="block text-[10px]">{day.count}건</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground leading-relaxed">{source.recoveryHelp}</p>
      {source.canRecover && (
        <Button variant="outline" size="sm" disabled={busy} onClick={onRecover}>
          {busy ? "재수집 진행 중" : "선택 기간 재수집"}
        </Button>
      )}
    </section>
  );
}

export default function DataStatusPage() {
  const { isLoading, isAuthenticated } = useRequireAuth();
  const { data: session } = useSession();
  const client = useQueryClient();
  const today = toKstCalendarDate(new Date());
  const [range, setRange] = useState(() => ({ from: shiftDateKey(today, -29), to: today }));
  const valid = validateStatusRange(range.from, range.to);
  const query = useQuery<DataStatusResponse>({
    queryKey: ["data-status", session?.session.id, range.from, range.to],
    enabled: isAuthenticated && valid,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/data-status?${new URLSearchParams(range)}`, { signal });
      if (!response.ok) throw new Error("수집 상태를 불러오지 못했습니다.");
      return response.json();
    },
    refetchInterval: (query) =>
      query.state.data?.jobs.some((job) => ["pending", "running"].includes(job.status))
        ? 5_000
        : 30_000,
  });
  const recovery = useMutation({
    mutationFn: async (source: string) => {
      const response = await fetch("/api/data-status/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, ...range }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "재수집을 요청하지 못했습니다.");
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["data-status"] }),
  });
  if (isLoading) return <p className="p-8">로그인 확인 중…</p>;
  if (!isAuthenticated) return null;
  return (
    <div className="min-h-screen bg-background">
      <Header showSync={false} />
      <main className="container mx-auto max-w-6xl p-4 py-6 space-y-5">
        <div className="flex justify-between gap-3 items-center">
          <h1 className="text-2xl font-bold">수집 상태</h1>
          <Link href="/settings" className="text-sm underline">
            연동 설정
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          날짜는 한국 시간 기준입니다. 기록이 없는 날은 활동이 없었을 수도 있어 수집 실패로 단정하지
          않습니다.
        </p>
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-sm space-y-1">
            시작일
            <input
              aria-label="시작일"
              className="block rounded border bg-background p-2"
              type="date"
              max={today}
              value={range.from}
              onChange={(e) => setRange((previous) => ({ ...previous, from: e.target.value }))}
            />
          </label>
          <label className="text-sm space-y-1">
            종료일
            <input
              aria-label="종료일"
              className="block rounded border bg-background p-2"
              type="date"
              max={today}
              value={range.to}
              onChange={(e) => setRange((previous) => ({ ...previous, to: e.target.value }))}
            />
          </label>
          <Button
            variant="outline"
            disabled={!valid || query.isFetching}
            onClick={() => query.refetch()}
          >
            새로고침
          </Button>
        </div>
        {!valid && (
          <p role="alert" className="text-sm text-destructive">
            오늘까지 최대 31일의 유효한 기간을 선택해 주세요.
          </p>
        )}
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(STATES).map(([key, state]) => (
            <span key={key} className={`rounded px-2 py-1 ${state.color}`}>
              {state.label}
            </span>
          ))}
        </div>
        {query.error && (
          <p role="alert" className="text-sm text-destructive">
            {query.error.message} 새로고침으로 다시 시도하세요.
          </p>
        )}
        {recovery.error && (
          <p role="alert" className="text-sm text-destructive">
            {recovery.error.message}
          </p>
        )}
        {recovery.isSuccess && (
          <p role="status" className="text-sm">
            재수집을 접수했습니다. 작업자가 분 단위로 처리하며 페이지를 닫아도 계속됩니다.
          </p>
        )}
        {query.isLoading && <p role="status">수집 상태를 불러오는 중…</p>}
        {valid && query.data && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {query.data.sources.map((source) => (
                <SourceCard
                  key={source.id}
                  source={source}
                  busy={
                    (recovery.isPending && recovery.variables === source.id) ||
                    query.data.jobs.some(
                      (job) =>
                        job.source === source.id && ["pending", "running"].includes(job.status)
                    )
                  }
                  onRecover={() => recovery.mutate(source.id)}
                />
              ))}
            </div>
            {query.data.jobs.length > 0 && (
              <section className="space-y-2">
                <h2 className="font-semibold">선택 기간 재수집 이력</h2>
                {query.data.jobs.map((job) => (
                  <div key={job.id} className="border rounded p-3 text-sm space-y-1">
                    <p>
                      {query.data.sources.find((source) => source.id === job.source)?.label} ·{" "}
                      {job.fromDate} ~ {job.toDate}
                    </p>
                    <p>
                      {job.status === "completed"
                        ? "완료"
                        : job.status === "failed"
                          ? `${job.nextDate} 처리 실패`
                          : `${job.nextDate}부터 ${job.status === "running" ? "처리 중" : "대기 중"}`}
                    </p>
                    {job.error && <p className="text-destructive">{job.error}</p>}
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
