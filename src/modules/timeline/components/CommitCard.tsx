"use client";

import { GitMerge, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TimelineCommit } from "../hooks";

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
  isExpanded: boolean;
  onToggle: () => void;
  isLast?: boolean;
}

const TYPE_STYLES: Record<string, string> = {
  feat: "commit-type-feat",
  fix: "commit-type-fix",
  test: "commit-type-test",
  perf: "commit-type-perf",
};

function getCommitType(message: string): string {
  return message.match(/^([a-z]+)(?:\([^)]+\))?!?:\s/i)?.[1].toLowerCase() ?? "commit";
}

function getMergePresentation(message: string): { prNumber: string | null; label: string } {
  const firstLine = message.split("\n")[0];
  const githubMerge = firstLine.match(/^Merge pull request #(\d+) from (?:[^/]+\/)?(.+)$/i);
  if (githubMerge) {
    return { prNumber: githubMerge[1], label: githubMerge[2] };
  }

  const prNumber = firstLine.match(/#(\d+)/)?.[1] ?? null;
  return { prNumber, label: firstLine.replace(/^Merge\s+/i, "") };
}

function formatCommitTime(value: string): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function CommitCard({
  commit,
  onStatsLoaded,
  isNew = false,
  animationDelay = 0,
  repoColor = "217 91% 60%",
  isExpanded,
  onToggle,
  isLast = false,
}: CommitCardProps) {
  const [statsState, setStatsState] = useState<{ stats: CommitStats | null; isLoading: boolean }>({
    stats: null,
    isLoading: false,
  });
  const [summaryState, setSummaryState] = useState<{
    isGenerating: boolean;
    status: string | undefined;
    localSummary: string | null;
  }>({
    isGenerating: false,
    status: commit.summary?.status,
    localSummary: null,
  });
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const summary = summaryState.localSummary ?? commit.summary?.summary;
  const isPending = summaryState.status === "pending";
  const isProcessing = summaryState.status === "processing" || summaryState.isGenerating;

  const pollSummaryStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/timeline/commits/${commit.id}`, {
        signal: abortControllerRef.current?.signal,
      });
      if (!response.ok) return;

      const data = await response.json();
      if (data.summary?.status === "completed" && data.summary?.summary) {
        setSummaryState({
          isGenerating: false,
          status: "completed",
          localSummary: data.summary.summary,
        });
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
      } else if (data.summary?.status === "failed") {
        setSummaryState((prev) => ({ ...prev, isGenerating: false, status: "failed" }));
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error("Failed to poll summary status:", error);
    }
  }, [commit.id]);

  useEffect(() => {
    abortControllerRef.current = new AbortController();
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleGenerateSummary = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (summaryState.isGenerating) return;

    setSummaryState((prev) => ({ ...prev, isGenerating: true, status: "processing" }));
    try {
      const response = await fetch(`/api/timeline/commits/${commit.id}/summary`, {
        method: "POST",
      });
      if (response.ok) {
        pollingRef.current = setInterval(pollSummaryStatus, 2000);
      } else {
        setSummaryState((prev) => ({ ...prev, isGenerating: false, status: "pending" }));
      }
    } catch (error) {
      console.error("Summary generation error:", error);
      setSummaryState((prev) => ({ ...prev, isGenerating: false, status: "pending" }));
    } finally {
      setSummaryState((prev) => ({ ...prev, isGenerating: false }));
    }
  };

  const displayStats = statsState.stats ?? {
    additions: commit.additions,
    deletions: commit.deletions,
    changedFilesCount: commit.changedFilesCount,
  };
  const hasStats =
    displayStats.additions > 0 || displayStats.deletions > 0 || displayStats.changedFilesCount > 0;
  const needsStatsLoad = !hasStats && !statsState.stats && !statsState.isLoading;

  const fetchStats = useCallback(async () => {
    setStatsState({ stats: null, isLoading: true });
    try {
      const response = await fetch(`/api/timeline/commits/${commit.id}/stats`, {
        method: "POST",
        signal: abortControllerRef.current?.signal,
      });
      const data = await response.json();
      if (data.additions !== undefined) {
        const stats = {
          additions: data.additions,
          deletions: data.deletions,
          changedFilesCount: data.changedFilesCount,
        };
        setStatsState({ stats, isLoading: false });
        onStatsLoaded?.(commit.id, stats);
      } else {
        setStatsState((prev) => ({ ...prev, isLoading: false }));
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error(error);
      setStatsState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [commit.id, onStatsLoaded]);

  useEffect(() => {
    if (isExpanded && needsStatsLoad) fetchStats();
  }, [fetchStats, isExpanded, needsStatsLoad]);

  const isMerge = commit.isMergeCommit;
  const mergePresentation = getMergePresentation(commit.message);
  const type = getCommitType(commit.message);
  const message = isMerge ? mergePresentation.label : commit.message.split("\n")[0];
  const repoName = commit.repository.fullName.split("/").at(-1) ?? commit.repository.fullName;
  const fileLabel = `${displayStats.changedFilesCount} ${displayStats.changedFilesCount === 1 ? "file" : "files"}`;
  const style = {
    "--repo-color": `hsl(${repoColor})`,
    "--repo-color-soft": `hsl(${repoColor} / 0.6)`,
    ...(isNew ? { animationDelay: `${animationDelay}ms` } : {}),
  } as React.CSSProperties;

  return (
    <div
      className={`commit-feed-row ${isMerge && !isExpanded ? "is-dimmed" : ""} ${isNew ? "animate-slide-up-fade animate-highlight" : ""}`}
      style={style}
    >
      <div className="commit-graph-rail" aria-hidden="true">
        <span className={`commit-graph-line ${isLast ? "is-last" : ""}`} />
        {isMerge && (
          <svg
            className="commit-branch"
            width="26"
            height="30"
            viewBox="0 0 26 30"
            aria-hidden="true"
          >
            <path d="M13 30 V24 C13 15 2 18 2 6" />
            <circle cx="2" cy="4" r="2.5" />
          </svg>
        )}
        <span
          className={`commit-node ${isMerge ? "is-merge" : ""} ${isExpanded ? "is-active" : ""}`}
        >
          {isMerge && <GitMerge size={isExpanded ? 8 : 7} strokeWidth={3.5} />}
        </span>
      </div>

      <div className={`commit-feed-card ${isExpanded ? "is-expanded" : ""}`}>
        <button
          type="button"
          className="commit-card-toggle"
          onClick={onToggle}
          aria-expanded={isExpanded}
          aria-label={`${repoName} 커밋 ${isExpanded ? "접기" : "펼치기"}`}
        />
        <span className="commit-meta-row">
          <span className="commit-repo">
            <span className="commit-repo-dot" />
            <span className="truncate">{repoName}</span>
          </span>
          <time dateTime={commit.committedAt}>{formatCommitTime(commit.committedAt)}</time>
        </span>

        <span className="commit-message-row">
          {isMerge ? (
            <span className="commit-pr-chip">
              {mergePresentation.prNumber ? `#${mergePresentation.prNumber}` : "merge"}
            </span>
          ) : (
            <span className={`commit-type-chip ${TYPE_STYLES[type] ?? "commit-type-default"}`}>
              {type}
            </span>
          )}
          <span className={`commit-message ${isMerge ? "is-merge" : ""}`}>{message}</span>
        </span>

        {isExpanded && (
          <span className="commit-summary animate-summary-reveal">
            {summary && <span>{summary}</span>}
            {isPending && !isProcessing && (
              <button
                type="button"
                className="commit-summary-action"
                onClick={handleGenerateSummary}
              >
                <Sparkles size={12} /> 요약 생성
              </button>
            )}
            {isProcessing && (
              <span className="commit-summary-loading">
                <Loader2 size={12} className="animate-spin" /> 요약 생성 중...
              </span>
            )}
            {!summary && !isPending && !isProcessing && <span>요약이 없습니다</span>}
          </span>
        )}

        <span className="commit-stats-row">
          <span>{commit.sha.slice(0, 7)}</span>
          {statsState.isLoading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <>
              <span className="commit-additions">+{displayStats.additions}</span>
              <span className="commit-deletions">−{displayStats.deletions}</span>
              <span className="commit-files">{fileLabel}</span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
