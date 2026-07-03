"use client";

import { Loader2, RefreshCw } from "lucide-react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Header } from "@/components/Layout/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parseDateParam, toLocalDateString } from "@/lib/utils";
import { useRequireAuth } from "@/modules/auth/hooks";
import { MapSkeleton } from "@/modules/location/components/MapSkeleton";
import { useSettings } from "@/modules/settings/hooks";
import { type RecentSyncJob, SyncStatusProvider } from "@/modules/sync/hooks";
import { Timeline } from "@/modules/timeline/components/Timeline";
import { useRepositories, useTimeline } from "@/modules/timeline/hooks";

const LocationMap = dynamic(
  () => import("@/modules/location/components/LocationMap").then((m) => m.LocationMap),
  { ssr: false, loading: () => <MapSkeleton /> }
);

function DashboardContent() {
  const searchParams = useSearchParams();
  const { isLoading: isAuthLoading, isAuthenticated } = useRequireAuth();
  const { settings } = useSettings();

  // Selected date for timeline + map (initialized from URL ?date= param)
  const today = useMemo(() => toLocalDateString(new Date()), []);
  const [selectedDate, setSelectedDateRaw] = useState<string>(() =>
    parseDateParam(searchParams.get("date"))
  );

  // Wrap setSelectedDate to sync URL
  const setSelectedDate = useCallback(
    (date: string) => {
      setSelectedDateRaw(date);
      const url = new URL(window.location.href);
      if (date === today) {
        url.searchParams.delete("date");
      } else {
        url.searchParams.set("date", date);
      }
      window.history.replaceState(null, "", url.toString());
    },
    [today]
  );

  const { commits, isLoading, hasNext, loadMore, refresh } = useTimeline();

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

  // 동기화 작업 완료 시 — 신규 커밋 추가 + 전체 새로고침 fallback
  const handleSyncCompleted = useCallback(
    (job: RecentSyncJob) => {
      if (job.totalCommits > 0) {
        toast.success(`동기화 완료: ${job.totalCommits}개의 커밋이 추가되었습니다`);
        refresh();
        refreshRepos();
      } else {
        toast.info("동기화 완료: 새로운 커밋이 없습니다");
      }
    },
    [refresh, refreshRepos]
  );

  // 모든 활성 작업 완료 시 (동기화 + 요약 모두 완료) — 요약 반영을 위해 현재 데이터 갱신
  const handleAllSyncFinished = useCallback(() => {
    toast.success("AI 요약 생성이 완료되었습니다");
    refresh();
  }, [refresh]);

  const handleSyncStarted = () => {
    toast.success("동기화가 시작되었습니다");
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const showEmptyState =
    !isLoading && !isLoadingRepos && commits.length === 0 && repositories.length === 0;

  return (
    <SyncStatusProvider
      onSyncCompleted={handleSyncCompleted}
      onAllSyncFinished={handleAllSyncFinished}
    >
      <div className="h-screen flex flex-col overflow-hidden bg-background">
        <Header onSyncStarted={handleSyncStarted} />

        {/* Main content */}
        <main className="flex-1 overflow-hidden flex flex-col container mx-auto px-4 py-4">
          {showEmptyState ? (
            // Empty state - first time user
            <div className="flex-1 flex items-center justify-center">
              <Card className="max-w-md">
                <CardHeader className="text-center">
                  <CardTitle>커밋 동기화하기</CardTitle>
                </CardHeader>
                <CardContent className="text-center space-y-4">
                  <p className="text-muted-foreground">
                    아직 동기화된 커밋이 없습니다.
                    <br />
                    동기화 버튼을 눌러 GitHub 커밋을 가져오세요.
                  </p>
                  <Button
                    onClick={() => {
                      fetch("/api/sync", { method: "POST" })
                        .then(() => {
                          toast.success("동기화가 시작되었습니다");
                        })
                        .catch(() => toast.error("동기화 시작에 실패했습니다"));
                    }}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    커밋 동기화 시작
                  </Button>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="flex-1 flex flex-col lg:flex-row gap-4 overflow-hidden">
              {/* Map */}
              <div className="flex-[2] min-h-0 lg:flex-1 rounded-lg overflow-hidden border">
                <LocationMap
                  date={selectedDate}
                  className="h-full w-full"
                  initialCenter={mapInitialCenter}
                />
              </div>

              {/* Timeline (only scrollable area) */}
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain lg:flex-1 pt-3 lg:pl-3 timeline-scroll-container">
                <Timeline
                  commits={commits}
                  isLoading={isLoading}
                  hasNext={hasNext}
                  onLoadMore={loadMore}
                  selectedDate={selectedDate}
                  onSelectedDateChange={setSelectedDate}
                />
              </div>
            </div>
          )}
        </main>
      </div>
    </SyncStatusProvider>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
