"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  GitCommit,
  GitMerge,
  Plus,
  Minus,
  FileText,
  Loader2,
  Sparkles,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import type { TimelineCommit } from "../hooks";
import { getCommitSize } from "../utils";

interface CommitStats {
  additions: number;
  deletions: number;
  changedFilesCount: number;
}

interface CommitCardProps {
  commit: TimelineCommit;
  onStatsLoaded?: (commitId: string, stats: CommitStats) => void;
  isNew?: boolean;
  animationDelay?: number;
  repoColor?: string;
}

export function CommitCard({ commit, onStatsLoaded, isNew = false, animationDelay = 0, repoColor }: CommitCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showScanFlash, setShowScanFlash] = useState(false);
  const [stats, setStats] = useState<CommitStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [summaryStatus, setSummaryStatus] = useState(commit.summary?.status);
  const [localSummary, setLocalSummary] = useState<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const summary = localSummary ?? commit.summary?.summary;
  const hasSummary = !!summary;
  const isPending = summaryStatus === "pending";
  const isProcessing = summaryStatus === "processing" || isGeneratingSummary;

  const abortControllerRef = useRef<AbortController | null>(null);

  // 폴링으로 요약 상태 확인
  const pollSummaryStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/timeline/commits/${commit.id}`, {
        signal: abortControllerRef.current?.signal,
      });
      if (response.ok) {
        const data = await response.json();
        if (data.summary?.status === "completed" && data.summary?.summary) {
          setLocalSummary(data.summary.summary);
          setSummaryStatus("completed");
          // 폴링 중지
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        } else if (data.summary?.status === "failed") {
          setSummaryStatus("failed");
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error("Failed to poll summary status:", error);
    }
  }, [commit.id]);

  // 컴포넌트 언마운트 시 폴링 및 진행 중 fetch 정리
  useEffect(() => {
    abortControllerRef.current = new AbortController();
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleGenerateSummary = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isGeneratingSummary) return;

    setIsGeneratingSummary(true);
    setSummaryStatus("processing");

    try {
      const response = await fetch(`/api/timeline/commits/${commit.id}/summary`, {
        method: "POST",
      });

      if (response.ok) {
        // 폴링 시작 (2초 간격으로 상태 확인)
        pollingRef.current = setInterval(pollSummaryStatus, 2000);
      } else {
        const data = await response.json();
        console.error("Summary generation failed:", data.error);
        setSummaryStatus("pending");
      }
    } catch (error) {
      console.error("Summary generation error:", error);
      setSummaryStatus("pending");
    } finally {
      setIsGeneratingSummary(false);
    }
  };

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
      fetch(`/api/timeline/commits/${commit.id}/stats`, {
        method: "POST",
        signal: abortControllerRef.current?.signal,
      })
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
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          console.error(err);
        })
        .finally(() => setIsLoadingStats(false));
    }
  }, [isExpanded, needsStatsLoad, commit.id, onStatsLoaded]);

  const commitSize = getCommitSize(commit);
  const isLarge = commitSize === "large";
  const isMerge = commit.isMergeCommit;

  const cardStyle: React.CSSProperties = {
    ...(repoColor ? { "--repo-color-glow": `hsl(${repoColor} / 0.3)` } as React.CSSProperties : {}),
    ...(isNew ? { animationDelay: `${animationDelay}ms` } : {}),
  };

  return (
    <Card
      className={`
        commit-card-hover cursor-pointer !py-0 !gap-0 !rounded-sm relative overflow-hidden
        ${isNew ? "animate-slide-up-fade animate-highlight" : ""}
        ${isLarge ? "large-commit-card" : ""}
        ${isMerge ? "opacity-70 bg-muted/30" : ""}
      `}
      style={cardStyle}
      onClick={() => {
        setIsExpanded(!isExpanded);
        setShowScanFlash(true);
        setTimeout(() => setShowScanFlash(false), 500);
      }}
    >
      {/* Scan flash on click */}
      {showScanFlash && <div className="ds-scan-flash" />}

      {/* Left repo color border */}
      {repoColor && (
        <div
          className={`absolute left-0 top-0 bottom-0 w-[3px] repo-border-glow ${isMerge ? "opacity-40" : ""}`}
          style={{
            ...(isMerge
              ? { backgroundImage: `repeating-linear-gradient(180deg, hsl(${repoColor}) 0px, hsl(${repoColor}) 4px, transparent 4px, transparent 8px)` }
              : { backgroundColor: `hsl(${repoColor})` }),
          }}
        />
      )}

      <CardContent className={`py-1.5 ${repoColor ? "pl-4 pr-3" : "px-3"} ${isLarge ? "py-2" : ""}`}>
        {/* 헤더 */}
        <div className="flex items-start gap-2">
          <Avatar className="h-5 w-5 flex-shrink-0 mt-0.5">
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
                <span className="inline-flex items-center gap-1 text-xs bg-transparent border border-[hsl(var(--ds-strand))] px-1.5 py-0.5 rounded-sm text-muted-foreground">
                  <GitMerge className="h-3 w-3" />
                  머지
                </span>
              )}
              {isProcessing && (
                <Sparkles className="h-3 w-3 text-primary animate-sparkle" />
              )}
              {hasSummary && summaryStatus === "completed" && (
                <Sparkles className="h-3 w-3 text-primary/60" />
              )}
              <span className="text-xs text-muted-foreground">
                {commit.repository.fullName}
              </span>
            </div>

            {/* 커밋 메시지 */}
            <p className="text-sm mt-0.5 break-words line-clamp-1 commit-message-text">{messageFirstLine}</p>

            {/* AI 요약 (접힌 상태에서도 표시) */}
            {hasSummary && (
              <p className={`text-xs mt-0.5 text-muted-foreground line-clamp-1 ${localSummary ? "animate-summary-reveal" : ""}`}>
                {summary}
              </p>
            )}
            {(isPending || isProcessing) && (
              <div className="flex items-center gap-2 mt-0.5">
                {isPending && !isProcessing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={handleGenerateSummary}
                  >
                    <Sparkles className="h-3 w-3 mr-1" />
                    요약 생성
                  </Button>
                )}
                {isProcessing && (
                  <p className="text-xs text-muted-foreground italic flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    요약 생성 중...
                  </p>
                )}
              </div>
            )}

            {/* 변경 통계 */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-0.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 dark:text-[hsl(195_45%_57%_/_0.6)]">
                <GitCommit className="h-3 w-3" />
                {commit.sha.slice(0, 7)}
              </span>
              {isLoadingStats && (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
              {hasStats && (
                <>
                  <span className="inline-flex items-center gap-1 text-green-600 dark:text-[#5CAACC]">
                    <Plus className="h-3 w-3" />
                    <AnimatedNumber value={displayStats.additions} />
                  </span>
                  <span className="inline-flex items-center gap-1 text-red-600 dark:text-[#DC8D18]">
                    <Minus className="h-3 w-3" />
                    <AnimatedNumber value={displayStats.deletions} />
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    <AnimatedNumber value={displayStats.changedFilesCount} suffix="개 파일" />
                  </span>
                </>
              )}
            </div>
            {/* Change ratio mini-bar */}
            {hasStats && (displayStats.additions + displayStats.deletions > 0) && (
              <div
                className="ds-change-ratio-bar mt-1"
                style={{ "--add-ratio": `${Math.round((displayStats.additions / (displayStats.additions + displayStats.deletions)) * 100)}%` } as React.CSSProperties}
              />
            )}
          </div>

        </div>

        {/* 확장 영역: AI 요약 */}
        {isExpanded && (
          <div className="mt-3 pt-3 animate-in fade-in-0 slide-in-from-top-2 duration-200">
            <div className="ds-expand-strand mb-3" />
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
              <p className={`text-sm leading-relaxed ${localSummary ? "animate-summary-reveal" : ""}`}>
                {summary}
              </p>
            )}

            {!hasSummary && !isPending && !isProcessing && (
              <p className="text-sm text-muted-foreground italic">
                요약을 생성할 수 없습니다
              </p>
            )}

            {/* 전체 커밋 메시지 (있을 경우) */}
            {hasMoreMessage && (
              <div className="mt-3 pt-3 border-t border-[hsl(var(--ds-strand-dim))]">
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
