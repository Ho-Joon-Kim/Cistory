"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Timeline } from "@/modules/timeline/components/Timeline";
import { Filters } from "@/modules/timeline/components/Filters";
import { useTimeline, useFilters } from "@/modules/timeline/hooks";
import { useAuth } from "@/modules/auth/hooks";
import { SyncStatusProvider, type RecentSyncJob } from "@/modules/sync/hooks";
import { Header } from "@/components/Layout/Header";
import { HolographicPanel } from "@/components/HolographicPanel";
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

  // 레포지토리 목록만 새로고침
  const refreshRepos = useCallback(() => {
    fetch("/api/timeline/repos")
      .then((res) => res.json() as Promise<{ repositories: Repository[] }>)
      .then((data) => setRepositories(data.repositories))
      .catch(console.error);
  }, []);

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
  };

  // Mobile bottom sheet drag
  const [sheetTop, setSheetTop] = useState(80); // percentage — collapsed by default
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startTop: number } | null>(null);

  const onDragStart = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    dragRef.current = { startY: clientY, startTop: sheetTop };
    setIsDragging(true);
  }, [sheetTop]);

  const onDragMove = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (!dragRef.current) return;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const deltaPercent = ((clientY - dragRef.current.startY) / window.innerHeight) * 100;
    const newTop = Math.min(80, Math.max(10, dragRef.current.startTop + deltaPercent));
    setSheetTop(newTop);
  }, []);

  const onDragEnd = useCallback(() => {
    if (!dragRef.current) return;
    setIsDragging(false);
    // Snap to nearest anchor: 10% (expanded), 32% (default), 80% (collapsed)
    setSheetTop((prev) => {
      if (prev < 20) return 10;
      if (prev > 55) return 80;
      return 32;
    });
    dragRef.current = null;
  }, []);

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
    <SyncStatusProvider
      onSyncCompleted={handleSyncCompleted}
      onAllSyncFinished={handleAllSyncFinished}
    >
      <div className="h-screen relative overflow-hidden bg-background ds-perspective">
        {/* z-0: Fullscreen map background */}
        <div className="absolute inset-0 z-0">
          <LocationMap date={selectedDate} className="h-full w-full" />
        </div>

        {/* z-10: Dark-mode ambient overlays (scan sweep only) */}
        <div className="absolute inset-0 z-10 pointer-events-none dark:block hidden">
          <div className="ds-ambient-scan absolute inset-0" />
        </div>

        {/* z-20: HUD layer */}
        <div className="absolute inset-0 z-20 pointer-events-none">
          {/* Floating HUD header */}
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

          {/* Right panel: Timeline or Empty state */}
          {showEmptyState ? (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-auto">
              <HolographicPanel className="max-w-md mx-4">
                <Card className="border-0 bg-transparent shadow-none">
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
              </HolographicPanel>
            </div>
          ) : (
            <>
              {/* Desktop: right-side floating panel */}
              <div className="hidden lg:block absolute right-4 top-16 bottom-4 w-[420px] pointer-events-auto">
                <HolographicPanel className="h-full ds-tilt-panel">
                  <div className="h-full overflow-y-auto overscroll-contain pl-3 pt-3 pr-2 pb-3 timeline-scroll-container">
                    <Timeline
                      commits={commits}
                      isLoading={isLoading}
                      hasNext={hasNext}
                      onLoadMore={loadMore}
                      selectedDate={selectedDate}
                      onSelectedDateChange={setSelectedDate}
                    />
                  </div>
                </HolographicPanel>
              </div>

              {/* Mobile: gradient fade above bottom sheet */}
              <div
                className={`lg:hidden absolute left-0 right-0 h-[10%] pointer-events-none z-[1] dark:bg-gradient-to-b dark:from-transparent dark:to-[rgba(10,14,23,0.6)] ${isDragging ? "" : "transition-[top] duration-300"}`}
                style={{ top: `${Math.max(0, sheetTop - 10)}%` }}
              />

              {/* Mobile: draggable bottom sheet */}
              <div
                className={`lg:hidden absolute left-0 right-0 bottom-0 pointer-events-auto ${isDragging ? "" : "transition-[top] duration-300"}`}
                style={{ top: `${sheetTop}%` }}
              >
                <HolographicPanel className="h-full rounded-t-lg">
                  {/* Drag handle — touch target */}
                  <div
                    className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing touch-none"
                    onTouchStart={onDragStart}
                    onTouchMove={onDragMove}
                    onTouchEnd={onDragEnd}
                    onMouseDown={onDragStart}
                    onMouseMove={onDragMove}
                    onMouseUp={onDragEnd}
                    onMouseLeave={onDragEnd}
                  >
                    <div className="w-12 h-1.5 rounded-full bg-[rgba(92,170,204,0.3)] dark:shadow-[0_0_6px_rgba(92,170,204,0.2)]" />
                  </div>
                  <div className="h-[calc(100%-28px)] overflow-y-auto overscroll-contain pl-3 pt-1 pr-2 pb-3 timeline-scroll-container touch-manipulation">
                    <Timeline
                      commits={commits}
                      isLoading={isLoading}
                      hasNext={hasNext}
                      onLoadMore={loadMore}
                      selectedDate={selectedDate}
                      onSelectedDateChange={setSelectedDate}
                    />
                  </div>
                </HolographicPanel>
              </div>
            </>
          )}
        </div>
      </div>
    </SyncStatusProvider>
  );
}
