"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Timeline } from "@/modules/timeline/components/Timeline";
import { Filters } from "@/modules/timeline/components/Filters";
import { useTimeline, useFilters } from "@/modules/timeline/hooks";
import { useAuth } from "@/modules/auth/hooks";
import { Header } from "@/components/Layout/Header";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface Repository {
  fullName: string;
  id: number | null;
  isPrivate: boolean | null;
  commitCount: number;
  lastCommitAt: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, isLoading: isAuthLoading, isAuthenticated } = useAuth();
  const { filters, setRepoFullName, setDateRange, clearFilters } = useFilters();

  const {
    commits,
    isLoading,
    hasNext,
    loadMore,
    refresh,
  } = useTimeline({ filters });

  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(true);
  const [summaryMode, setSummaryMode] = useState<"technical" | "nonTechnical">(
    "nonTechnical"
  );

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
    // Refresh timeline after a delay
    setTimeout(() => {
      refresh();
      // Also refresh repos list
      fetch("/api/timeline/repos")
        .then((res) => res.json() as Promise<{ repositories: Repository[] }>)
        .then((data) => setRepositories(data.repositories))
        .catch(console.error);
    }, 5000);
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
    <div className="min-h-screen bg-background">
      <Header onSyncStarted={handleSyncStarted} />

      {/* Main content */}
      <main className="container mx-auto px-4 py-6">
        {showEmptyState ? (
          // Empty state - first time user
          <Card className="max-w-md mx-auto">
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
                    setTimeout(() => {
                      refresh();
                      fetch("/api/timeline/repos")
                        .then((res) => res.json() as Promise<{ repositories: Repository[] }>)
                        .then((data) => setRepositories(data.repositories))
                        .catch(console.error);
                    }, 5000);
                  })
                  .catch(() => toast.error("동기화 시작에 실패했습니다"));
              }}>
                <RefreshCw className="h-4 w-4 mr-2" />
                커밋 동기화 시작
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Filters */}
            <Filters
              repositories={repositories}
              selectedRepoFullName={filters.repoFullName}
              onRepoFullNameChange={setRepoFullName}
              dateFrom={filters.from}
              dateTo={filters.to}
              onDateRangeChange={setDateRange}
              summaryMode={summaryMode}
              onSummaryModeChange={setSummaryMode}
              onClearFilters={clearFilters}
            />

            {/* Timeline */}
            <Timeline
              commits={commits}
              isLoading={isLoading}
              hasNext={hasNext}
              onLoadMore={loadMore}
              summaryMode={summaryMode}
            />
          </div>
        )}
      </main>
    </div>
  );
}
