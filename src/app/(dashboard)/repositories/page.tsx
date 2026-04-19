"use client";

import { GitCommit, GitFork, Globe, Loader2, Lock } from "lucide-react";
import Link from "next/link";
import { Header } from "@/components/Layout/Header";
import { Card, CardContent } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/utils";
import { useRequireAuth } from "@/modules/auth/hooks";
import { SyncStatusProvider } from "@/modules/sync/hooks";
import { useRepositories } from "@/modules/timeline/hooks";

export default function RepositoriesPage() {
  const { isLoading: isAuthLoading, isAuthenticated } = useRequireAuth();
  const { repositories, isLoading } = useRepositories(isAuthenticated);

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

  const totalCommits = repositories.reduce((sum, r) => sum + Number(r.commitCount), 0);

  return (
    <SyncStatusProvider>
      <div className="min-h-screen bg-background">
        <Header />

        <main className="container mx-auto px-4 py-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold">레포지토리</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {repositories.length}개 레포지토리 · {totalCommits}개 커밋
            </p>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : repositories.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <GitFork className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>동기화된 레포지토리가 없습니다.</p>
                <p className="text-sm mt-2">타임라인에서 동기화를 시작해주세요.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {repositories.map((repo) => (
                <Link
                  key={repo.fullName}
                  href={`/dashboard?repos=${encodeURIComponent(repo.fullName)}`}
                >
                  <Card className="transition-all hover:shadow-md hover:border-primary/50 cursor-pointer">
                    <CardContent className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex-shrink-0">
                            {repo.isPrivate ? (
                              <Lock className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <Globe className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium truncate">{repo.fullName}</p>
                            <p className="text-xs text-muted-foreground">
                              마지막 커밋 {formatRelativeTime(repo.lastCommitAt)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground flex-shrink-0">
                          <GitCommit className="h-4 w-4" />
                          <span>{repo.commitCount}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </main>
      </div>
    </SyncStatusProvider>
  );
}
