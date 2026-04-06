"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface UseRouteReplayOptions {
  locations: { lat: number; lon: number; timestamp: string }[];
  stayPoints?: { lat: number; lon: number; startTime: string; endTime: string }[];
}

interface UseRouteReplayReturn {
  state: "idle" | "playing" | "paused";
  currentCoord: { lat: number; lon: number } | null;
  currentTimestamp: string | null;
  progress: number;
  speed: number;
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (progress: number) => void;
  setSpeed: (speed: number) => void;
}

interface SortedPoint {
  lat: number;
  lon: number;
  time: number;
  timestamp: string;
}

/** Linear interpolation between two coordinates */
function lerpCoord(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  t: number,
): { lat: number; lon: number } {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t,
  };
}

/** Find coord and timestamp for a given progress (0-1) along sorted points */
function getPositionAtProgress(
  points: SortedPoint[],
  progress: number,
): { coord: { lat: number; lon: number }; timestamp: string } | null {
  if (points.length === 0) return null;
  if (points.length === 1) return { coord: { lat: points[0].lat, lon: points[0].lon }, timestamp: points[0].timestamp };

  const totalDuration = points[points.length - 1].time - points[0].time;
  if (totalDuration === 0) {
    return { coord: { lat: points[0].lat, lon: points[0].lon }, timestamp: points[0].timestamp };
  }

  const targetTime = points[0].time + progress * totalDuration;

  // Binary search for the segment containing targetTime
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (points[mid].time <= targetTime) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const a = points[lo];
  const b = points[hi];
  const segDuration = b.time - a.time;
  const t = segDuration > 0 ? (targetTime - a.time) / segDuration : 0;
  const coord = lerpCoord(a, b, Math.min(1, Math.max(0, t)));

  // Pick the closer timestamp
  const timestamp = t < 0.5 ? a.timestamp : b.timestamp;
  return { coord, timestamp };
}

export function useRouteReplay({
  locations,
  stayPoints = [],
}: UseRouteReplayOptions): UseRouteReplayReturn {
  const [state, setState] = useState<"idle" | "playing" | "paused">("idle");
  const [currentCoord, setCurrentCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [currentTimestamp, setCurrentTimestamp] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeedState] = useState(1);

  const stateRef = useRef(state);
  const progressRef = useRef(progress);
  const speedRef = useRef(speed);
  const rafRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);
  const stayPauseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStayPausedRef = useRef(false);

  // Keep refs in sync
  stateRef.current = state;
  progressRef.current = progress;
  speedRef.current = speed;

  // Sort locations by timestamp once
  const sortedPoints = useRef<SortedPoint[]>([]);
  const stayRanges = useRef<{ start: number; end: number }[]>([]);

  useEffect(() => {
    sortedPoints.current = locations
      .map((l) => ({
        lat: l.lat,
        lon: l.lon,
        time: new Date(l.timestamp).getTime(),
        timestamp: l.timestamp,
      }))
      .sort((a, b) => a.time - b.time);

    stayRanges.current = stayPoints.map((sp) => ({
      start: new Date(sp.startTime).getTime(),
      end: new Date(sp.endTime).getTime(),
    }));
  }, [locations, stayPoints]);

  /** Check if a given simulated time falls within any stay point range */
  const isInStayPoint = useCallback((simulatedTime: number): boolean => {
    for (const range of stayRanges.current) {
      if (simulatedTime >= range.start && simulatedTime <= range.end) {
        return true;
      }
    }
    return false;
  }, []);

  const updatePosition = useCallback((prog: number) => {
    const result = getPositionAtProgress(sortedPoints.current, prog);
    if (result) {
      setCurrentCoord(result.coord);
      setCurrentTimestamp(result.timestamp);
    }
    setProgress(prog);
  }, []);

  const animationLoop = useCallback(
    (now: number) => {
      if (stateRef.current !== "playing" || isStayPausedRef.current) return;

      const points = sortedPoints.current;
      if (points.length < 2) return;

      const totalDuration = points[points.length - 1].time - points[0].time;
      if (totalDuration === 0) return;

      const delta = now - lastFrameTimeRef.current;
      lastFrameTimeRef.current = now;

      // Convert frame delta to simulated time progress
      // speed multiplier: real elapsed * speed = simulated elapsed
      // Base playback: 1x maps the entire route to ~60 seconds of real time
      const basePlaybackRate = totalDuration / 60000;
      const simulatedDelta = delta * speedRef.current * basePlaybackRate;
      const progressDelta = simulatedDelta / totalDuration;

      const newProgress = Math.min(1, progressRef.current + progressDelta);
      updatePosition(newProgress);

      if (newProgress >= 1) {
        setState("idle");
        return;
      }

      // Check if we just entered a stay point
      const currentSimTime = points[0].time + newProgress * totalDuration;
      if (isInStayPoint(currentSimTime)) {
        isStayPausedRef.current = true;
        const pauseDuration = 1500 / speedRef.current;
        stayPauseTimeoutRef.current = setTimeout(() => {
          isStayPausedRef.current = false;
          if (stateRef.current === "playing") {
            lastFrameTimeRef.current = performance.now();
            rafRef.current = requestAnimationFrame(animationLoop);
          }
        }, pauseDuration);
        return;
      }

      rafRef.current = requestAnimationFrame(animationLoop);
    },
    [updatePosition, isInStayPoint],
  );

  const play = useCallback(() => {
    if (sortedPoints.current.length < 2) return;

    // If we were idle, start from 0
    if (stateRef.current === "idle") {
      updatePosition(0);
    }

    setState("playing");
    isStayPausedRef.current = false;
    lastFrameTimeRef.current = performance.now();
    rafRef.current = requestAnimationFrame(animationLoop);
  }, [animationLoop, updatePosition]);

  const pause = useCallback(() => {
    setState("paused");
    cancelAnimationFrame(rafRef.current);
    if (stayPauseTimeoutRef.current) {
      clearTimeout(stayPauseTimeoutRef.current);
      stayPauseTimeoutRef.current = null;
    }
    isStayPausedRef.current = false;
  }, []);

  const stop = useCallback(() => {
    setState("idle");
    cancelAnimationFrame(rafRef.current);
    if (stayPauseTimeoutRef.current) {
      clearTimeout(stayPauseTimeoutRef.current);
      stayPauseTimeoutRef.current = null;
    }
    isStayPausedRef.current = false;
    setProgress(0);
    setCurrentCoord(null);
    setCurrentTimestamp(null);
  }, []);

  const seek = useCallback(
    (newProgress: number) => {
      const clamped = Math.min(1, Math.max(0, newProgress));
      updatePosition(clamped);

      // If playing, reset the frame clock so delta doesn't jump
      if (stateRef.current === "playing") {
        lastFrameTimeRef.current = performance.now();
        // Clear any stay pause in progress
        if (stayPauseTimeoutRef.current) {
          clearTimeout(stayPauseTimeoutRef.current);
          stayPauseTimeoutRef.current = null;
        }
        isStayPausedRef.current = false;
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(animationLoop);
      }
    },
    [updatePosition, animationLoop],
  );

  const setSpeed = useCallback((newSpeed: number) => {
    setSpeedState(newSpeed);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (stayPauseTimeoutRef.current) {
        clearTimeout(stayPauseTimeoutRef.current);
      }
    };
  }, []);

  // Reset when locations change
  useEffect(() => {
    stop();
  }, [locations, stop]);

  return {
    state,
    currentCoord,
    currentTimestamp,
    progress,
    speed,
    play,
    pause,
    stop,
    seek,
    setSpeed,
  };
}
