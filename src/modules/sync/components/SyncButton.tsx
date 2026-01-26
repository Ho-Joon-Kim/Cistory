"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSync } from "../hooks";

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

  const handleSync = async () => {
    const success = await sync();
    if (success) {
      onSyncStarted?.();
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleSync}
      disabled={isSyncing}
      className={className}
    >
      <RefreshCw
        className={`h-4 w-4 ${size !== "icon" ? "mr-2" : ""} ${
          isSyncing ? "animate-spin" : ""
        }`}
      />
      {size !== "icon" && (isSyncing ? "동기화 중..." : "동기화")}
    </Button>
  );
}
