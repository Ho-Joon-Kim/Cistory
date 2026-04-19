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

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleSync}
      disabled={isActive}
      className={className}
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
