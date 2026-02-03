"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Timeline } from "@/modules/timeline/components/Timeline";
import { Filters } from "@/modules/timeline/components/Filters";
import { useTimeline, useFilters } from "@/modules/timeline/hooks";
import { useAuth } from "@/modules/auth/hooks";
import { useSyncStatus, type RecentSyncJob } from "@/modules/sync/hooks";
import { Header } from "@/components/Layout/Header";
import { MapSkeleton } from "@/modules/location/components/MapSkeleton";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const LocationMap = dynamic(
  () => import("@/modules/location/components/LocationMap").then((m) => m.LocationMap),
  { ssr: false, loading: () => <MapSkeleton /> }
);

interface Repository {
  fullName: string;
  id: number | null;
  isPrivate: boolean | null;
  commitCount: number;
  lastCommitAt: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading: isAuthLoading, isAuthenticated } = useAuth();

  // Selected date for timeline + map
  const [selectedDate, setSelectedDate] = useState<string>(
    () => new Date().toISOString().split("T")[0]
  );

  // URL 쿼리 파라미터에서 repos 읽기 (초기값)
  const initialRepos = searchParams.get("repos")?.split(",").filter(Boolean) ?? [];
  const { filters, setRepoFullNames, setDateRange, clearFilters } = useFilters(
    initialRepos.length > 0 ? initialRepos : undefined
  );

  const {
    commits,
    isLoading,
    hasNext,
    loadMore,
    refresh,
  } = useTimeline({ filters });

  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(true);

  // 타임라인과 레포지토리 목록 새로고침 함수
  const refreshAll = useCallback(() => {
    refresh();
    fetch("/api/timeline/repos")
      .then((res) => res.json() as Promise<{ repositories: Repository[] }>)
      .then((data) => setRepositories(data.repositories))
      .catch(console.error);
  }, [refresh]);

  // 동기화 작업 완료 시 (커밋 fetch 완료)
  const handleSyncCompleted = useCallback(
    (job: RecentSyncJob) => {
      if (job.totalCommits > 0) {
        toast.success(`동기화 완료: ${job.totalCommits}개의 커밋이 추가되었습니다`);
      } else {
        toast.info("동기화 완료: 새로운 커밋이 없습니다");
      }
      refreshAll();
    },
    [refreshAll]
  );

  // 모든 활성 작업 완료 시 (동기화 + 요약 모두 완료)
  const handleAllSyncFinished = useCallback(() => {
    toast.success("AI 요약 생성이 완료되었습니다");
    refreshAll();
  }, [refreshAll]);

  // SSE로 동기화 상태 모니터링
  useSyncStatus(handleSyncCompleted, handleAllSyncFinished);

  // Auth check
  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthLoading, isAuthenticated, router]);

  // Fetch unique repositories from commits
  useEffect(() => {
    if (!isAuthenticated) return;

    async function fetchRepos() {
      setIsLoadingRepos(true);
      try {
        const response = await fetch("/api/timeline/repos");
        if (response.ok) {
          const data = (await response.json()) as { repositories: Repository[] };
          setRepositories(data.repositories);
        }
      } catch (error) {
        console.error("Failed to fetch repositories:", error);
      } finally {
        setIsLoadingRepos(false);
      }
    }

    fetchRepos();
  }, [isAuthenticated]);

  const handleSyncStarted = () => {
    toast.success("동기화가 시작되었습니다");
    // 동기화 완료는 SSE를 통해 자동으로 감지되어 새로고침됨
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

  const showEmptyState = !isLoading && !isLoadingRepos && commits.length === 0 && repositories.length === 0;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <Header
        onSyncStarted={handleSyncStarted}
        actions={
          !showEmptyState ? (
            <Filters
              repositories={repositories}
              selectedRepoFullNames={filters.repoFullNames ?? []}
              onRepoFullNamesChange={setRepoFullNames}
              dateFrom={filters.from}
              dateTo={filters.to}
              onDateRangeChange={setDateRange}
              onClearFilters={clearFilters}
            />
          ) : undefined
        }
      />

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
                <Button onClick={() => {
                  fetch("/api/sync", { method: "POST" })
                    .then(() => {
                      toast.success("동기화가 시작되었습니다");
                    })
                    .catch(() => toast.error("동기화 시작에 실패했습니다"));
                }}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  커밋 동기화 시작
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="flex-1 flex flex-col lg:flex-row gap-4 overflow-hidden">
            {/* Map */}
            <div className="shrink-0 h-[250px] lg:h-auto lg:flex-1 rounded-lg overflow-hidden border">
              <LocationMap date={selectedDate} className="h-full w-full" />
            </div>

            {/* Timeline (only scrollable area) */}
            <div className="flex-1 overflow-y-auto overscroll-contain lg:flex-1 pl-3 pt-3 timeline-scroll-container">
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
  );
}
