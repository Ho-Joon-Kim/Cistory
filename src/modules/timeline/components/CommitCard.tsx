"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronUp,
  GitCommit,
  GitMerge,
  Plus,
  Minus,
  FileText,
  Loader2,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import type { TimelineCommit } from "../hooks";

interface CommitStats {
  additions: number;
  deletions: number;
  changedFilesCount: number;
}

interface CommitCardProps {
  commit: TimelineCommit;
  onStatsLoaded?: (commitId: string, stats: CommitStats) => void;
}

export function CommitCard({ commit, onStatsLoaded }: CommitCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [stats, setStats] = useState<CommitStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);

  const summary = commit.summary?.summary;
  const hasSummary = !!summary;
  const isPending = commit.summary?.status === "pending";
  const isProcessing = commit.summary?.status === "processing";

  // 커밋 메시지 첫 줄
  const messageFirstLine = commit.message.split("\n")[0];
  const hasMoreMessage = commit.message.includes("\n");

  // 현재 표시할 stats (로컬 상태 또는 commit에서)
  const displayStats: CommitStats = stats ?? {
    additions: commit.additions,
    deletions: commit.deletions,
    changedFilesCount: commit.changedFilesCount,
  };
  const hasStats = displayStats.additions > 0 || displayStats.deletions > 0 || displayStats.changedFilesCount > 0;
  const needsStatsLoad = !hasStats && !stats && !isLoadingStats;

  // 확장 시 stats 로드
  useEffect(() => {
    if (isExpanded && needsStatsLoad) {
      setIsLoadingStats(true);
      fetch(`/api/timeline/commits/${commit.id}/stats`, { method: "POST" })
        .then((res) => res.json())
        .then((data) => {
          if (data.additions !== undefined) {
            const newStats = {
              additions: data.additions,
              deletions: data.deletions,
              changedFilesCount: data.changedFilesCount,
            };
            setStats(newStats);
            onStatsLoaded?.(commit.id, newStats);
          }
        })
        .catch(console.error)
        .finally(() => setIsLoadingStats(false));
    }
  }, [isExpanded, needsStatsLoad, commit.id, onStatsLoaded]);

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="px-3 py-2">
        {/* 헤더 */}
        <div className="flex items-start gap-2">
          <Avatar className="h-6 w-6 flex-shrink-0">
            <AvatarImage src={commit.authorAvatarUrl ?? undefined} />
            <AvatarFallback className="text-xs">
              {commit.authorName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{commit.authorName}</span>
              <span className="text-xs text-muted-foreground">
                {formatRelativeTime(commit.committedAt)}
              </span>
              {commit.isMergeCommit && (
                <span className="inline-flex items-center gap-1 text-xs bg-secondary px-1.5 py-0.5 rounded">
                  <GitMerge className="h-3 w-3" />
                  머지
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {commit.repository.fullName}
              </span>
            </div>

            {/* 커밋 메시지 */}
            <p className="text-sm mt-1 break-words">{messageFirstLine}</p>

            {/* 변경 통계 */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <GitCommit className="h-3 w-3" />
                {commit.sha.slice(0, 7)}
              </span>
              {isLoadingStats && (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
              {hasStats && (
                <>
                  <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                    <Plus className="h-3 w-3" />
                    {displayStats.additions}
                  </span>
                  <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                    <Minus className="h-3 w-3" />
                    {displayStats.deletions}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    {displayStats.changedFilesCount}개 파일
                  </span>
                </>
              )}
            </div>
          </div>

          {/* 확장 버튼 */}
          <Button
            variant="ghost"
            size="sm"
            className="flex-shrink-0"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* 확장 영역: AI 요약 */}
        {isExpanded && (
          <div className="mt-4 pt-4 border-t">
            <h4 className="text-xs font-medium text-muted-foreground mb-2">
              AI 요약
            </h4>

            {isPending && (
              <p className="text-sm text-muted-foreground italic">
                요약 생성 대기 중...
              </p>
            )}

            {isProcessing && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                요약 생성 중...
              </div>
            )}

            {hasSummary && (
              <p className="text-sm leading-relaxed">{summary}</p>
            )}

            {!hasSummary && !isPending && !isProcessing && (
              <p className="text-sm text-muted-foreground italic">
                요약을 생성할 수 없습니다
              </p>
            )}

            {/* 전체 커밋 메시지 (있을 경우) */}
            {hasMoreMessage && (
              <div className="mt-3 pt-3 border-t">
                <h4 className="text-xs font-medium text-muted-foreground mb-2">
                  전체 커밋 메시지
                </h4>
                <pre className="text-xs bg-muted p-3 rounded-md whitespace-pre-wrap font-mono">
                  {commit.message}
                </pre>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
