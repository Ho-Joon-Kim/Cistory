"use client";

import { CheckCircle2, XCircle, Loader2, Clock, GitCommit } from "lucide-react";
import { Progress } from "@/components/ui/progress";
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

export function SyncStatus({ showDetails = true }: SyncStatusProps) {
  const { status, isConnected } = useSyncStatus();

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

    if (!showDetails) {
      return (
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm">동기화 중...</span>
        </div>
      );
    }

    return (
      <Popover>
        <PopoverTrigger asChild>
          <button className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm font-medium">동기화 중</span>
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
                <Badge variant="outline" className="text-xs text-yellow-600">
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

  // 동기화가 없을 때
  if (!showDetails) {
    return (
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-green-500" />
        <span className="text-sm text-muted-foreground">
          {formatTime(status.lastSyncTime)}
        </span>
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-sm text-muted-foreground">
            마지막 동기화: {formatTime(status.lastSyncTime)}
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
                      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500 shrink-0" />
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
