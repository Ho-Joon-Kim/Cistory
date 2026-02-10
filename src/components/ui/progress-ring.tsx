"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface ProgressRingProps {
  value: number; // 0-100
  size?: number;
  strokeWidth?: number;
  className?: string;
  showCheck?: boolean;
}

export function ProgressRing({
  value,
  size = 20,
  strokeWidth = 2,
  className,
  showCheck = false,
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (value / 100) * circumference;

  const isComplete = value >= 100;

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      {/* Background circle */}
      <svg
        width={size}
        height={size}
        className="rotate-[-90deg]"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted opacity-30"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn(
            "text-primary transition-all duration-300 ease-out",
            isComplete && "text-[#5CAACC]"
          )}
        />
      </svg>

      {/* Check mark on complete */}
      {showCheck && isComplete && (
        <div className="absolute inset-0 flex items-center justify-center animate-success-pulse">
          <Check className="h-3 w-3 text-[#5CAACC] animate-check-draw" />
        </div>
      )}

      {/* Percentage text (optional, for larger sizes) */}
      {!showCheck && size >= 40 && (
        <span className="absolute text-[10px] font-medium tabular-nums">
          {Math.round(value)}
        </span>
      )}
    </div>
  );
}

interface SyncProgressRingProps {
  isSyncing: boolean;
  progress?: number;
  showComplete?: boolean;
  size?: number;
  className?: string;
}

export function SyncProgressRing({
  isSyncing,
  progress = 0,
  showComplete = false,
  size = 16,
  className,
}: SyncProgressRingProps) {
  const [showCheck, setShowCheck] = React.useState(false);

  React.useEffect(() => {
    if (showComplete && !isSyncing) {
      setShowCheck(true);
      const timer = setTimeout(() => setShowCheck(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [showComplete, isSyncing]);

  if (!isSyncing && !showCheck) {
    return null;
  }

  if (showCheck) {
    return (
      <div
        className={cn("inline-flex items-center justify-center animate-success-pulse", className)}
        style={{ width: size, height: size }}
      >
        <Check className="text-[#5CAACC]" style={{ width: size * 0.75, height: size * 0.75 }} />
      </div>
    );
  }

  // Indeterminate spinner if no progress
  if (progress === 0) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        className={cn("animate-progress-spin", className)}
      >
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-muted opacity-30"
        />
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="28"
          strokeDashoffset="21"
          className="text-primary"
        />
      </svg>
    );
  }

  return (
    <ProgressRing
      value={progress}
      size={size}
      strokeWidth={2}
      className={className}
    />
  );
}
