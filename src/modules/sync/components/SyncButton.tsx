"use client";

import { useState, useEffect } from "react";
import { RefreshCw, Check } from "lucide-react";
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
  const [showComplete, setShowComplete] = useState(false);
  const [wasActive, setWasActive] = useState(false);

  // Track sync completion for success animation
  useEffect(() => {
    if (status?.hasActiveSync) {
      setWasActive(true);
    } else if (wasActive && !status?.hasActiveSync) {
      // Sync just completed
      setShowComplete(true);
      setWasActive(false);
      const timer = setTimeout(() => setShowComplete(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [status?.hasActiveSync, wasActive]);

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
      className={`ds-button ${className ?? ""}`}
    >
      {showComplete ? (
        <Check className={`h-4 w-4 text-[#5CAACC] animate-success-pulse ${size !== "icon" ? "mr-2" : ""}`} />
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
      {size !== "icon" && (
        showComplete ? "완료!" : isActive ? `동기화 중${progress > 0 ? ` ${progress}%` : "..."}` : "동기화"
      )}
    </Button>
  );
}
