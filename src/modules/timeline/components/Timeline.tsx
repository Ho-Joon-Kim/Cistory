"use client";

import { Code, Loader2, MapPin } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { TrackCard } from "@/modules/location/components/TrackCard";
import {
  type StayPointData,
  type TrackData,
  useDailyDistances,
  useStayPoints,
  useTracks,
} from "@/modules/location/hooks";
import type { TransactionItem } from "@/modules/spending/hooks";
import { CodingSessionCard } from "@/modules/wakatime/components/CodingSessionCard";
import type { CodingSessionData, CodingStatData } from "@/modules/wakatime/hooks";
import { useCodingSessions, useCodingStats } from "@/modules/wakatime/hooks";
import type { TimelineCommit } from "../hooks";
import { useTransactionsForDate } from "../hooks";
import type { TimelineEvent } from "../types";
import type { DateEntry } from "../utils";
import {
  fillDateRange,
  formatCodingTime,
  formatDistance,
  getRepoColor,
  groupEventsByTimeOfDay,
} from "../utils";
import { CommitCard } from "./CommitCard";
import { CompactCommitCard } from "./CompactCommitCard";
import { StayPointCard } from "./StayPointCard";
import { TimelineSkeleton } from "./TimelineSkeleton";
import { TransactionCard } from "./TransactionCard";

interface TimelineProps {
  commits: TimelineCommit[];
  isLoading: boolean;
  hasNext: boolean;
  onLoadMore: () => void;
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
}

// --- Viewport visibility hook for each date group ---
function useDateGroupVisibility(scrollRoot: React.RefObject<Element | null>) {
  const refs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [visibleGroups, setVisibleGroups] = useState<Set<string>>(new Set());
  const observersRef = useRef<Map<string, IntersectionObserver>>(new Map());

  const setRef = useCallback(
    (key: string) => (el: HTMLDivElement | null) => {
      if (el) {
        refs.current.set(key, el);

        if (!visibleGroups.has(key) && !observersRef.current.has(key)) {
          const observer = new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (entry.isIntersecting) {
                  setVisibleGroups((prev) => new Set([...prev, key]));
                  observer.disconnect();
                  observersRef.current.delete(key);
                }
              }
            },
            { threshold: 0.1, root: scrollRoot.current }
          );
          observer.observe(el);
          observersRef.current.set(key, observer);
        }
      }
    },
    [visibleGroups, scrollRoot]
  );

  useEffect(() => {
    return () => {
      for (const observer of observersRef.current.values()) {
        observer.disconnect();
      }
    };
  }, []);

  return { setRef, visibleGroups, refs };
}

// --- Date group section ---
interface DateGroupSectionProps {
  entry: DateEntry;
  isSelected: boolean;
  isVisible: boolean;
  setRef: (key: string) => (el: HTMLDivElement | null) => void;
  repoColorMap: Map<string, string>;
  newCommitIds: Set<string>;
  onSelectDate: (date: string) => void;
  distanceMeters?: number;
  codingSeconds?: number;
  codingSessions?: CodingSessionData[];
  codingStats?: CodingStatData;
  tracks?: TrackData[];
  stayPoints?: StayPointData[];
  transactions?: TransactionItem[];
}

const DateGroupSection = memo(function DateGroupSection({
  entry,
  isSelected,
  isVisible,
  setRef,
  repoColorMap,
  newCommitIds,
  onSelectDate,
  distanceMeters,
  codingSeconds,
  codingSessions,
  codingStats,
  tracks,
  stayPoints,
  transactions,
}: DateGroupSectionProps) {
  const { date, commits: dateCommits, isEmpty } = entry;
  const { label, isToday } = formatDateHeader(date);

  // Build unified timeline events for the selected date
  const hasAnyData =
    !isEmpty ||
    (stayPoints && stayPoints.length > 0) ||
    (tracks && tracks.length > 0) ||
    (codingSessions && codingSessions.length > 0) ||
    (transactions && transactions.length > 0);
  const unifiedEventGroups = useMemo(() => {
    if (!isSelected || !hasAnyData) return null;

    const events: TimelineEvent[] = [];

    for (const commit of dateCommits) {
      events.push({ type: "commit", timestamp: commit.committedAt, data: commit });
    }

    if (stayPoints) {
      for (const sp of stayPoints) {
        events.push({ type: "stay", timestamp: sp.startTime, data: sp });
      }
    }

    if (codingSessions && codingSessions.length > 0) {
      const earliest = codingSessions.reduce((a, b) =>
        new Date(a.startedAt).getTime() < new Date(b.startedAt).getTime() ? a : b
      );
      events.push({
        type: "coding",
        timestamp: earliest.startedAt,
        data: { sessions: codingSessions, stats: codingStats },
      });
    }

    if (tracks) {
      for (const track of tracks) {
        events.push({ type: "track", timestamp: track.startTime, data: track });
      }
    }

    if (transactions) {
      for (const tx of transactions) {
        events.push({ type: "transaction", timestamp: tx.transactedAt, data: tx });
      }
    }

    if (events.length === 0) return null;
    return groupEventsByTimeOfDay(events);
  }, [
    isSelected,
    hasAnyData,
    dateCommits,
    stayPoints,
    codingSessions,
    codingStats,
    tracks,
    transactions,
  ]);

  return (
    <div
      ref={setRef(date)}
      className={`date-group-section relative ${isVisible ? "is-visible" : ""}`}
    >
      {/* Date header */}
      <div className="relative flex items-center mb-2">
        {/* Stepper dot as button */}
        <button
          type="button"
          className={`
            stepper-dot absolute left-1 md:left-3 flex items-center justify-center w-6 h-6
          `}
          onClick={() => onSelectDate(date)}
          aria-label={`${label} 선택`}
        >
          <span
            className={`
              block rounded-full transition-all duration-200
              ${
                isSelected
                  ? "w-3 h-3 bg-primary animate-pulse-glow"
                  : "w-2.5 h-2.5 bg-muted-foreground hover:bg-muted-foreground"
              }
            `}
          />
        </button>

        <div
          className="ml-10 md:ml-14 flex items-center gap-2 cursor-pointer"
          onClick={() => onSelectDate(date)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelectDate(date);
            }
          }}
          aria-label={`${label} 선택`}
        >
          <h3
            className={`text-sm font-medium transition-colors duration-200 ${
              isSelected
                ? isToday
                  ? "text-primary"
                  : "text-foreground"
                : "text-muted-foreground/50"
            }`}
          >
            {label}
          </h3>
          <span
            className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-medium transition-colors duration-200 ${
              isSelected ? "bg-muted text-muted-foreground" : "bg-muted/50 text-muted-foreground/50"
            }`}
          >
            <AnimatedNumber value={dateCommits.length} />
          </span>
          {distanceMeters != null && distanceMeters > 0 && (
            <span
              className={`inline-flex items-center gap-0.5 h-5 px-1.5 rounded-full text-[10px] font-medium transition-colors duration-200 ${
                isSelected ? "bg-primary/15 text-primary" : "bg-muted/50 text-muted-foreground/50"
              }`}
            >
              <MapPin className="w-3 h-3" />
              {formatDistance(distanceMeters)}
            </span>
          )}
          {codingSeconds != null && codingSeconds > 0 && (
            <span
              className={`inline-flex items-center gap-0.5 h-5 px-1.5 rounded-full text-[10px] font-medium transition-colors duration-200 ${
                isSelected
                  ? "bg-violet-500/15 text-violet-600 dark:text-violet-400"
                  : "bg-muted/50 text-muted-foreground/50"
              }`}
            >
              <Code className="w-3 h-3" />
              {formatCodingTime(codingSeconds)}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="ml-10 md:ml-14">
        {/* Selected date: unified timeline */}
        {isSelected && unifiedEventGroups && (
          <div className="space-y-1">
            {unifiedEventGroups.map((subGroup, sgIndex) => (
              <div key={sgIndex}>
                {subGroup.label && (
                  <div className="flex items-center gap-2 py-2">
                    <span className="text-[11px] text-muted-foreground/50 font-medium tracking-wide">
                      {subGroup.label}
                    </span>
                    <div className="subgroup-divider h-px bg-muted-foreground/15 flex-1" />
                  </div>
                )}
                <div className="space-y-1">
                  {subGroup.events.map((event, index) => {
                    switch (event.type) {
                      case "commit":
                        return (
                          <div
                            key={`commit-${event.data.id}`}
                            className="relative commit-card-stagger"
                          >
                            <div className="timeline-tick absolute -left-[23px] md:-left-[31px] top-1/2 -translate-y-1/2" />
                            <CommitCard
                              commit={event.data}
                              isNew={newCommitIds.has(event.data.id)}
                              animationDelay={index * 50}
                              repoColor={repoColorMap.get(event.data.repository.fullName)}
                            />
                          </div>
                        );
                      case "coding":
                        return (
                          <CodingSessionCard
                            key="coding-summary"
                            sessions={event.data.sessions}
                            stats={event.data.stats}
                          />
                        );
                      case "stay":
                        return (
                          <StayPointCard
                            key={`stay-${event.data.lat}-${event.data.lon}-${event.data.startTime}`}
                            stayPoint={event.data}
                          />
                        );
                      case "track":
                        return <TrackCard key={`track-${event.data.id}`} track={event.data} />;
                      case "transaction":
                        return (
                          <TransactionCard key={`tx-${event.data.id}`} transaction={event.data} />
                        );
                      default:
                        return null;
                    }
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Selected but truly empty */}
        {isSelected && !unifiedEventGroups && (
          <p className="text-sm text-muted-foreground/60 py-2">이 날의 활동이 없습니다</p>
        )}

        {/* Non-selected: compact commits */}
        {!isSelected && !isEmpty && (
          <div>
            {dateCommits.map((commit) => (
              <CompactCommitCard
                key={commit.id}
                commit={commit}
                onSelectDate={() => onSelectDate(date)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

export function Timeline({
  commits,
  isLoading,
  hasNext,
  onLoadMore,
  selectedDate,
  onSelectedDateChange,
}: TimelineProps) {
  const observerTarget = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<Element | null>(null);
  const [commitTracking, setCommitTracking] = useState<{
    seenIds: Set<string>;
    newIds: Set<string>;
  }>({ seenIds: new Set(), newIds: new Set() });
  const isFirstRender = useRef(true);
  const { setRef, visibleGroups, refs } = useDateGroupVisibility(scrollContainerRef);

  const newCommitIds = commitTracking.newIds;

  // Track new commits for animation
  useEffect(() => {
    if (commits.length === 0) return;

    const currentIds = new Set(commits.map((c) => c.id));

    if (isFirstRender.current) {
      setCommitTracking({ seenIds: currentIds, newIds: new Set() });
      isFirstRender.current = false;
      return;
    }

    setCommitTracking((prev) => {
      const newIds = new Set<string>();
      for (const id of currentIds) {
        if (!prev.seenIds.has(id)) {
          newIds.add(id);
        }
      }

      if (newIds.size > 0) {
        return { seenIds: currentIds, newIds };
      }
      return prev;
    });
  }, [commits]);

  // Clear new commit animation after timeout
  useEffect(() => {
    if (commitTracking.newIds.size === 0) return;
    const timer = setTimeout(() => {
      setCommitTracking((prev) => ({ ...prev, newIds: new Set() }));
    }, 3000);
    return () => clearTimeout(timer);
  }, [commitTracking.newIds]);

  // Infinite scroll
  useEffect(() => {
    const target = observerTarget.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNext && !isLoading) {
          onLoadMore();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(target);

    return () => observer.disconnect();
  }, [hasNext, isLoading, onLoadMore]);

  // Repo color map
  const repoColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const commit of commits) {
      const name = commit.repository.fullName;
      if (!map.has(name)) {
        map.set(name, getRepoColor(name));
      }
    }
    return map;
  }, [commits]);

  // Group by date and fill range
  const filledDates = useMemo(() => {
    const grouped = groupCommitsByDate(commits);
    return fillDateRange(grouped);
  }, [commits]);

  // Compute date range for daily distances
  const { dateFrom, dateTo } = useMemo(() => {
    if (filledDates.length === 0) return { dateFrom: "", dateTo: "" };
    return {
      dateFrom: filledDates[filledDates.length - 1].date,
      dateTo: filledDates[0].date,
    };
  }, [filledDates]);

  const { distances } = useDailyDistances(dateFrom, dateTo);

  // Coding stats for date range badges
  const { stats: codingStatsArray } = useCodingStats(dateFrom, dateTo);
  const codingSecondsMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const stat of codingStatsArray) {
      map[stat.date] = stat.totalSeconds;
    }
    return map;
  }, [codingStatsArray]);
  const codingStatsMap = useMemo(() => {
    const map: Record<string, CodingStatData> = {};
    for (const stat of codingStatsArray) {
      map[stat.date] = stat;
    }
    return map;
  }, [codingStatsArray]);

  // Coding sessions for selected date
  const { sessions: codingSessions } = useCodingSessions(selectedDate);

  // Tracks for selected date
  const { tracks: selectedDateTracks } = useTracks(selectedDate);

  // Stay points for selected date
  const { stayPoints: selectedDateStayPoints } = useStayPoints(selectedDate);

  // Transactions for selected date
  const { transactions: selectedDateTransactions } = useTransactionsForDate(selectedDate);

  // Fallback: compute coding seconds from sessions for selected date badge
  const selectedDateSessionSeconds = useMemo(() => {
    if (codingSessions.length === 0) return 0;
    return codingSessions.reduce((sum, s) => sum + s.durationSeconds, 0);
  }, [codingSessions]);

  // Stepper line gradient position
  const containerRef = useRef<HTMLDivElement>(null);
  const [glowY, setGlowY] = useState<number | null>(null);

  // Resolve the scroll container once on mount
  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      scrollContainerRef.current = el.closest(".timeline-scroll-container") ?? null;
    }
  }, []);

  // Compute glow position + scroll on selection
  const isInitialScroll = useRef(true);
  useEffect(() => {
    const el = refs.current.get(selectedDate);
    if (el) {
      // Use offsetTop for stable position relative to containerRef (position:relative parent)
      const dotY = el.offsetTop + 12;
      setGlowY(dotY);
    }

    if (el) {
      const today = new Date().toISOString().split("T")[0];
      if (isInitialScroll.current) {
        isInitialScroll.current = false;
        // Skip scroll only if initial date is today (already at top)
        if (selectedDate === today) return;
      }
      const sc = scrollContainerRef.current;
      if (sc) {
        const offset = el.offsetTop - 16;
        sc.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
      } else {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }, [selectedDate, refs]);

  if (isLoading && commits.length === 0) {
    return <TimelineSkeleton />;
  }

  if (commits.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="text-lg">커밋이 없습니다</p>
        <p className="text-sm mt-2">레포지토리를 추적하면 커밋 타임라인이 여기에 표시됩니다</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Continuous stepper line with gradient glow from selected date */}
      <div
        className="stepper-line absolute left-[15px] md:left-[23px] top-0 bottom-0 w-0.5 rounded-full"
        style={glowY !== null ? ({ "--glow-y": `${glowY}px` } as React.CSSProperties) : undefined}
      />

      <div className="space-y-4">
        {filledDates.map((entry) => (
          <DateGroupSection
            key={entry.date}
            entry={entry}
            isSelected={entry.date === selectedDate}
            isVisible={visibleGroups.has(entry.date)}
            setRef={setRef}
            repoColorMap={repoColorMap}
            newCommitIds={newCommitIds}
            onSelectDate={onSelectedDateChange}
            distanceMeters={distances[entry.date]}
            codingSeconds={
              codingSecondsMap[entry.date] ??
              (entry.date === selectedDate ? selectedDateSessionSeconds : undefined)
            }
            codingSessions={entry.date === selectedDate ? codingSessions : undefined}
            codingStats={codingStatsMap[entry.date]}
            tracks={entry.date === selectedDate ? selectedDateTracks : undefined}
            stayPoints={entry.date === selectedDate ? selectedDateStayPoints : undefined}
            transactions={entry.date === selectedDate ? selectedDateTransactions : undefined}
          />
        ))}
      </div>

      {/* Loading indicator & Observer target */}
      <div ref={observerTarget} className="py-8 flex justify-center">
        {isLoading && commits.length > 0 && (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        )}
      </div>
    </div>
  );
}

function groupCommitsByDate(commits: TimelineCommit[]): Record<string, TimelineCommit[]> {
  const groups: Record<string, TimelineCommit[]> = {};

  for (const commit of commits) {
    const date = commit.committedAt.split("T")[0];
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(commit);
  }

  return groups;
}

function formatDateHeader(dateStr: string): { label: string; isToday: boolean } {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const isToday = date.toDateString() === today.toDateString();
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) return { label: "오늘", isToday: true };
  if (isYesterday) return { label: "어제", isToday: false };

  return {
    label: date.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    isToday: false,
  };
}
