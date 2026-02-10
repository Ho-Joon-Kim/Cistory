"use client";

import { useState, useEffect } from "react";
import { CheckCircle2, XCircle, Loader2, Clock, GitCommit } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { ProgressRing } from "@/components/ui/progress-ring";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useSyncStatus } from "../hooks";
import { SyncButton } from "./SyncButton";

interface SyncStatusProps {
  showDetails?: boolean;
}

const syncTypeLabels: Record<string, string> = {
  events: "이벤트 동기화",
  search: "검색 동기화",
  initial: "초기 동기화",
};

// 다음 10분 cron까지 남은 시간 계산
function useNextSyncProgress() {
  const [progress, setProgress] = useState(0);
  const [remainingMinutes, setRemainingMinutes] = useState<number | null>(null);

  useEffect(() => {
    const calculateProgress = () => {
      const now = new Date();
      const currentMinutes = now.getMinutes();
      const currentSeconds = now.getSeconds();

      // 다음 10분 단위 시간 계산 (예: 09:18 → 09:20, 09:20 → 09:30)
      const minutesUntilNextCron = 10 - (currentMinutes % 10);
      const secondsUntilNextCron = minutesUntilNextCron * 60 - currentSeconds;

      // 0~10분 사이클에서 진행률 계산
      const elapsedInCycle = (currentMinutes % 10) * 60 + currentSeconds;
      const prog = (elapsedInCycle / 600) * 100; // 600초 = 10분

      setProgress(prog);
      setRemainingMinutes(Math.ceil(secondsUntilNextCron / 60));
    };

    calculateProgress();
    const interval = setInterval(calculateProgress, 10000); // 10초마다 업데이트

    return () => clearInterval(interval);
  }, []);

  return { progress, remainingMinutes };
}

export function SyncStatus({ showDetails = true }: SyncStatusProps) {
  const { status, isConnected } = useSyncStatus();
  const { progress: syncProgress, remainingMinutes } = useNextSyncProgress();

  if (!status) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>상태 확인 중...</span>
      </div>
    );
  }

  const formatTime = (isoString: string | null) => {
    if (!isoString) return "알 수 없음";
    const date = new Date(isoString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return "방금 전";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
    return date.toLocaleDateString("ko-KR");
  };

  const getSyncTypeLabel = (syncType: string) => {
    return syncTypeLabels[syncType] || syncType;
  };

  // 간단한 상태 표시 (활성 동기화가 있을 때)
  if (status.hasActiveSync) {
    const activeJob = status.activeJobs[0];
    const progress = activeJob?.progress ?? 0;

    if (!showDetails) {
      return (
        <div className="flex items-center gap-2">
          <ProgressRing value={progress} size={16} />
          <span className="text-sm ds-sync-timer syncing">동기화 중... {progress > 0 && `${progress}%`}</span>
        </div>
      );
    }

    return (
      <Popover>
        <PopoverTrigger asChild>
          <button className="ds-button flex items-center gap-2 rounded-md px-2 py-1 border border-transparent">
            <ProgressRing value={progress} size={16} />
            <span className="text-sm font-medium ds-sync-timer syncing">동기화 중 {progress > 0 && `${progress}%`}</span>
            <Badge variant="secondary" className="text-xs">
              {status.activeJobs.length}
            </Badge>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80" align="end">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">동기화 진행 중</h4>
              {!isConnected && (
                <Badge variant="outline" className="text-xs text-accent">
                  연결 끊김
                </Badge>
              )}
            </div>

            {status.activeJobs.map((job) => (
              <div key={job.id} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="truncate font-medium">
                    {getSyncTypeLabel(job.syncType)}
                  </span>
                  <span className="text-muted-foreground">{job.progress}%</span>
                </div>
                <Progress value={job.progress} className="h-2" />
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <GitCommit className="h-3 w-3" />
                  <span>
                    {job.processedCommits} / {job.totalCommits} 커밋
                  </span>
                </div>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // 남은 시간 포맷
  const formatRemaining = (minutes: number | null) => {
    if (minutes === null) return "";
    if (minutes === 0) return "곧 동기화";
    if (minutes < 60) return `${minutes}분 후`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}시간 ${mins}분 후` : `${hours}시간 후`;
  };

  // 동기화가 없을 때
  if (!showDetails) {
    return (
      <div className="flex items-center gap-2">
        <ProgressRing value={syncProgress} size={16} />
        <span className="text-sm text-muted-foreground ds-sync-timer">
          {formatRemaining(remainingMinutes)}
        </span>
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="ds-button flex items-center gap-2 rounded-md px-2 py-1 border border-transparent">
          <ProgressRing value={syncProgress} size={16} />
          <span className="text-sm text-muted-foreground ds-sync-timer">
            {remainingMinutes === 0 ? "곧 동기화" : `다음 동기화: ${formatRemaining(remainingMinutes)}`}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">동기화 상태</h4>
            <SyncButton size="sm" variant="outline" />
          </div>

          {status.recentCompleted.length > 0 ? (
            <div className="space-y-2">
              <h5 className="text-sm text-muted-foreground">최근 동기화</h5>
              {status.recentCompleted.slice(0, 3).map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between text-sm"
                >
                  <div className="flex items-center gap-2 truncate">
                    {job.status === "completed" ? (
                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-accent shrink-0" />
                    )}
                    <span className="truncate">{getSyncTypeLabel(job.syncType)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground shrink-0">
                    <span>{job.totalCommits} 커밋</span>
                    <Clock className="h-3 w-3" />
                    <span>{formatTime(job.completedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              최근 동기화 기록이 없습니다
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
