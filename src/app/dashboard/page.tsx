"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { LoadingState, PageContainer } from "@/components/ds";
import { Header } from "@/components/Layout/Header";
import { toKstCalendarDate } from "@/lib/date-key";
import { parseDateParam } from "@/lib/utils";
import { useRequireAuth } from "@/modules/auth/hooks";
import { useSettings } from "@/modules/settings/hooks";
import { type RecentSyncJob, SyncStatusProvider } from "@/modules/sync/hooks";
import { DayView } from "@/modules/timeline/components/day/DayView";
import { startInitialSync, useRepositories } from "@/modules/timeline/hooks";

/** The page frame with a map-shaped skeleton, like every other page's loading state. */
function DashboardLoading() {
  return (
    <div className="min-h-dvh bg-page">
      <Header />
      <PageContainer>
        <LoadingState variant="block" label="하루 기록을 불러오는 중" />
      </PageContainer>
    </div>
  );
}

function FirstSyncNotice() {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface p-3 shadow-ring">
      <p className="m-0 text-[13px] leading-5 text-ink-2">
        아직 동기화된 커밋이 없어요. 생활 기록은 아래에서 확인하세요.
      </p>
      <button
        type="button"
        className="inline-flex h-8 items-center rounded-lg border-0 bg-brand px-3 text-[13px] font-semibold text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        onClick={async () => {
          try {
            await startInitialSync();
            toast.success("동기화를 시작했어요.");
          } catch {
            toast.error("동기화를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.");
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
    error: reposError,
    refresh: refreshRepos,
  } = useRepositories(isAuthenticated);

  const refreshCommits = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["timeline"] });
  }, [queryClient]);

  // 동기화 작업 완료 시 — 신규 커밋 반영
  const handleSyncCompleted = useCallback(
    (job: RecentSyncJob) => {
      if (job.totalCommits > 0) {
        toast.success(`커밋 ${job.totalCommits.toLocaleString("ko-KR")}건을 동기화했어요.`);
        refreshCommits();
        refreshRepos();
      } else {
        toast.info("동기화했어요. 새 커밋은 없어요.");
      }
    },
    [refreshCommits, refreshRepos]
  );

  // 모든 활성 작업 완료 시 (동기화 + 요약) — 요약 반영을 위해 갱신
  const handleAllSyncFinished = useCallback(() => {
    toast.success("AI 요약을 만들었어요.");
    refreshCommits();
  }, [refreshCommits]);

  const handleSyncStarted = () => {
    toast.success("동기화를 시작했어요.");
  };

  if (isAuthLoading) {
    return <DashboardLoading />;
  }

  if (!isAuthenticated) return null;

  // A failed repository load is not an empty account — don't invite a first sync.
  const showFirstSync = !isLoadingRepos && !reposError && repositories.length === 0;

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
    <Suspense fallback={<DashboardLoading />}>
      <DashboardContent />
    </Suspense>
  );
}
