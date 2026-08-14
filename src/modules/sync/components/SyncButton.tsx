"use client";

import { Check, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SyncProgressRing } from "@/components/ui/progress-ring";
import { useSync, useSyncStatus } from "../hooks";

interface SyncButtonProps {
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  onSyncStarted?: () => void;
}

export function SyncButton({
  variant = "outline",
  size = "default",
  className,
  onSyncStarted,
}: SyncButtonProps) {
  const { isSyncing, sync } = useSync();
  const { status } = useSyncStatus();
  const [completionState, setCompletionState] = useState<{
    showComplete: boolean;
    wasActive: boolean;
  }>({ showComplete: false, wasActive: false });

  // Track sync completion for success animation
  useEffect(() => {
    setCompletionState((prev) => {
      if (status?.hasActiveSync) {
        return { ...prev, wasActive: true };
      }
      if (prev.wasActive && !status?.hasActiveSync) {
        return { showComplete: true, wasActive: false };
      }
      return prev;
    });
  }, [status?.hasActiveSync]);

  // Clear completion indicator after timeout
  useEffect(() => {
    if (!completionState.showComplete) return;
    const timer = setTimeout(
      () => setCompletionState((prev) => ({ ...prev, showComplete: false })),
      2000
    );
    return () => clearTimeout(timer);
  }, [completionState.showComplete]);

  const handleSync = async () => {
    const success = await sync();
    if (success) {
      onSyncStarted?.();
    }
  };

  const isActive = status?.hasActiveSync || isSyncing;
  const progress = status?.activeJobs?.[0]?.progress ?? 0;

  // 상태 문구는 아이콘 모드에서 렌더되지 않으므로(아래 `size !== "icon"` 분기),
  // 그 경우 버튼에 남는 이름이 없다. lucide 1.0부터 아이콘이 기본 aria-hidden이라
  // 아이콘이 이름을 대신 메워 줄 여지도 없어, 같은 문구를 aria-label로 붙인다.
  const label = completionState.showComplete
    ? "동기화 완료"
    : isActive
      ? `동기화 중${progress > 0 ? ` ${progress}%` : ""}`
      : "동기화";

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleSync}
      disabled={isActive}
      className={className}
      aria-label={size === "icon" ? label : undefined}
    >
      {completionState.showComplete ? (
        <Check
          className={`h-4 w-4 text-green-500 animate-success-pulse ${size !== "icon" ? "mr-2" : ""}`}
        />
      ) : isActive ? (
        <SyncProgressRing
          isSyncing={true}
          progress={progress}
          size={16}
          className={size !== "icon" ? "mr-2" : ""}
        />
      ) : (
        <RefreshCw className={`h-4 w-4 ${size !== "icon" ? "mr-2" : ""}`} />
      )}
      {size !== "icon" &&
        (completionState.showComplete
          ? "완료!"
          : isActive
            ? `동기화 중${progress > 0 ? ` ${progress}%` : "..."}`
            : "동기화")}
    </Button>
  );
}
