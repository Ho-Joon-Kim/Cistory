"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Header } from "@/components/Layout/Header";
import { toKstCalendarDate } from "@/lib/date-key";
import { parseDateParam } from "@/lib/utils";
import { useRequireAuth } from "@/modules/auth/hooks";
import { useSettings } from "@/modules/settings/hooks";
import { type RecentSyncJob, SyncStatusProvider } from "@/modules/sync/hooks";
import { DayView } from "@/modules/timeline/components/day/DayView";
import { startInitialSync, useRepositories } from "@/modules/timeline/hooks";

function FirstSyncNotice() {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface p-3 shadow-ring">
      <p className="m-0 text-[13px] leading-5 text-ink-2">
        아직 동기화된 커밋이 없습니다. 생활 기록은 아래에서 확인하세요.
      </p>
      <button
        type="button"
        className="inline-flex h-8 items-center rounded-lg border-0 bg-brand px-3 text-[13px] font-semibold text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        onClick={async () => {
          try {
            await startInitialSync();
            toast.success("동기화가 시작되었습니다.");
          } catch {
            toast.error("동기화를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
          }
        }}
      >
        커밋 동기화
      </button>
    </div>
  );
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { isLoading: isAuthLoading, isAuthenticated } = useRequireAuth();
  const { settings } = useSettings();

  const today = useMemo(() => toKstCalendarDate(new Date()), []);
  const [selectedDate, setSelectedDateRaw] = useState<string>(() =>
    parseDateParam(searchParams.get("date"))
  );

  // Keep ?date= in the URL (omitted for today) without a navigation.
  const setSelectedDate = useCallback(
    (date: string) => {
      setSelectedDateRaw(date);
      const url = new URL(window.location.href);
      if (date === today) url.searchParams.delete("date");
      else url.searchParams.set("date", date);
      window.history.replaceState(null, "", url.toString());
    },
    [today]
  );

  const mapInitialCenter = useMemo(() => {
    if (settings?.lastLat != null && settings?.lastLon != null) {
      return { latitude: settings.lastLat, longitude: settings.lastLon };
    }
    return null;
  }, [settings?.lastLat, settings?.lastLon]);

  const {
    repositories,
    isLoading: isLoadingRepos,
    refresh: refreshRepos,
  } = useRepositories(isAuthenticated);

  const refreshCommits = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["timeline"] });
  }, [queryClient]);

  // 동기화 작업 완료 시 — 신규 커밋 반영
  const handleSyncCompleted = useCallback(
    (job: RecentSyncJob) => {
      if (job.totalCommits > 0) {
        toast.success(`커밋 ${job.totalCommits}개가 동기화되었습니다.`);
        refreshCommits();
        refreshRepos();
      } else {
        toast.info("동기화되었습니다. 새 커밋은 없습니다.");
      }
    },
    [refreshCommits, refreshRepos]
  );

  // 모든 활성 작업 완료 시 (동기화 + 요약) — 요약 반영을 위해 갱신
  const handleAllSyncFinished = useCallback(() => {
    toast.success("AI 요약이 생성되었습니다.");
    refreshCommits();
  }, [refreshCommits]);

  const handleSyncStarted = () => {
    toast.success("동기화가 시작되었습니다.");
  };

  if (isAuthLoading) {
    return (
      <div role="status" className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-ink-3" aria-hidden="true" />
        <span className="sr-only">로딩 중…</span>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const showFirstSync = !isLoadingRepos && repositories.length === 0;

  return (
    <SyncStatusProvider
      onSyncCompleted={handleSyncCompleted}
      onAllSyncFinished={handleAllSyncFinished}
    >
      <div className="min-h-dvh bg-page">
        <Header onSyncStarted={handleSyncStarted} />
        <DayView
          date={selectedDate}
          today={today}
          onDateChange={setSelectedDate}
          initialCenter={mapInitialCenter}
          notice={showFirstSync ? <FirstSyncNotice /> : null}
        />
      </div>
    </SyncStatusProvider>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div role="status" className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-ink-3" aria-hidden="true" />
          <span className="sr-only">로딩 중…</span>
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
