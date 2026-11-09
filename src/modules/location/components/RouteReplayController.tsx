"use client";

import { Gauge, LocateFixed, Pause, Play, Square } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { Slider } from "@/components/ui/slider";

interface RouteReplayControllerProps {
  state: "idle" | "playing" | "paused";
  progress: number;
  currentTimestamp: string | null;
  speed: number;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (progress: number) => void;
  onSpeedChange: (speed: number) => void;
  isFollowing: boolean;
  onRecenter: () => void;
}

const SPEED_STEPS = [1, 2, 4];

function formatTimeHHMM(isoString: string | null): string {
  if (!isoString) return "--:--";
  const d = new Date(isoString);
  return d.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function RouteReplayController({
  state,
  progress,
  currentTimestamp,
  speed,
  onPlay,
  onPause,
  onStop,
  onSeek,
  onSpeedChange,
  isFollowing,
  onRecenter,
}: RouteReplayControllerProps) {
  // Radix renders the focusable role="slider" on the thumb, which the shared
  // Slider doesn't expose, so name it here once it mounts.
  const sliderRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    sliderRef.current?.querySelector('[role="slider"]')?.setAttribute("aria-label", "재생 위치");
  }, []);

  const handlePlayPause = useCallback(() => {
    if (state === "playing") {
      onPause();
    } else {
      onPlay();
    }
  }, [state, onPlay, onPause]);

  const handleSpeedCycle = useCallback(() => {
    const currentIndex = SPEED_STEPS.indexOf(speed);
    const nextIndex = (currentIndex + 1) % SPEED_STEPS.length;
    onSpeedChange(SPEED_STEPS[nextIndex]);
  }, [speed, onSpeedChange]);

  const handleSliderChange = useCallback(
    (value: number[]) => {
      onSeek(value[0] / 100);
    },
    [onSeek]
  );

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 px-2 sm:px-3 pb-2">
      <div className="bg-background/90 backdrop-blur rounded-lg border shadow-sm px-2 sm:px-3 py-2 flex items-center gap-1.5 sm:gap-2">
        {/* Play/Pause */}
        <button
          type="button"
          onClick={handlePlayPause}
          className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent transition-colors"
          aria-label={state === "playing" ? "일시정지" : "재생"}
        >
          {state === "playing" ? (
            <Pause className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Play className="h-4 w-4" aria-hidden="true" />
          )}
        </button>

        {/* Stop */}
        <button
          type="button"
          onClick={onStop}
          className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent transition-colors"
          aria-label="재생 중지"
        >
          <Square className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        {/* Speed badge */}
        <button
          type="button"
          onClick={handleSpeedCycle}
          className="flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium bg-muted hover:bg-accent transition-colors tabular-nums"
          aria-label={`재생 속도 ${speed}배`}
        >
          <Gauge className="h-3 w-3" aria-hidden="true" />
          {speed}x
        </button>

        <button
          type="button"
          onClick={onRecenter}
          className={`flex items-center justify-center h-7 w-7 rounded-md transition-colors ${
            isFollowing ? "bg-primary/10 text-primary" : "hover:bg-accent text-muted-foreground"
          }`}
          aria-label={isFollowing ? "경로 따라가기 사용 중" : "경로 다시 따라가기"}
          title={isFollowing ? "경로 따라가기 사용 중" : "경로 다시 따라가기"}
        >
          <LocateFixed className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        {/* Progress slider */}
        <div className="flex-1 min-w-0 px-1">
          <Slider
            ref={sliderRef}
            aria-label="재생 위치"
            value={[progress * 100]}
            min={0}
            max={100}
            step={0.1}
            onValueChange={handleSliderChange}
            className="w-full"
          />
        </div>

        {/* Current time display */}
        <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap min-w-[3rem] text-right">
          {formatTimeHHMM(currentTimestamp)}
        </span>
      </div>
    </div>
  );
}
