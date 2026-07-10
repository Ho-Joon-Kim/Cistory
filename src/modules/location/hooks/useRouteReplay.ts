"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

interface StayRange {
  start: number;
  end: number;
}

/** Linear interpolation between two coordinates */
function lerpCoord(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  t: number
): { lat: number; lon: number } {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t,
  };
}

/** Find coord and timestamp for a given progress (0-1) along sorted points */
export function getPositionAtProgress(
  points: SortedPoint[],
  progress: number
): { coord: { lat: number; lon: number }; timestamp: string } | null {
  if (points.length === 0) return null;
  if (points.length === 1)
    return { coord: { lat: points[0].lat, lon: points[0].lon }, timestamp: points[0].timestamp };

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

  // Keep the clock on the same continuous timeline as the marker. Returning
  // the nearest raw point's timestamp makes the replay clock visibly jump.
  const timestamp = new Date(targetTime).toISOString();
  return { coord, timestamp };
}

/** Convert an absolute timestamp to normalized progress along a replay. */
export function getProgressAtTime(points: SortedPoint[], time: number): number {
  if (points.length < 2) return 0;
  const start = points[0].time;
  const duration = points[points.length - 1].time - start;
  if (duration <= 0) return 0;
  return Math.min(1, Math.max(0, (time - start) / duration));
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
  const activeStayRangeIndexRef = useRef(-1);
  const replayPointsRef = useRef<SortedPoint[] | null>(null);
  const replayStayRangesRef = useRef<StayRange[] | null>(null);

  // Keep refs in sync
  stateRef.current = state;
  progressRef.current = progress;
  speedRef.current = speed;

  // Sort locations by timestamp once
  const sortedPoints = useRef<SortedPoint[]>([]);
  const stayRanges = useRef<StayRange[]>([]);

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

  /** Find the stay point range containing a given simulated time. */
  const getStayRangeIndex = useCallback((simulatedTime: number): number => {
    const ranges = replayStayRangesRef.current ?? stayRanges.current;
    for (let index = 0; index < ranges.length; index++) {
      const range = ranges[index];
      if (simulatedTime >= range.start && simulatedTime <= range.end) {
        return index;
      }
    }
    return -1;
  }, []);

  const updatePosition = useCallback((prog: number) => {
    const points = replayPointsRef.current ?? sortedPoints.current;
    const result = getPositionAtProgress(points, prog);
    if (result) {
      setCurrentCoord(result.coord);
      setCurrentTimestamp(result.timestamp);
    }
    progressRef.current = prog;
    setProgress(prog);
  }, []);

  const animationLoop = useCallback(
    (now: number) => {
      if (stateRef.current !== "playing" || isStayPausedRef.current) return;

      const points = replayPointsRef.current ?? sortedPoints.current;
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
        stateRef.current = "idle";
        setState("idle");
        return;
      }

      // Check if we just entered a stay point
      const currentSimTime = points[0].time + newProgress * totalDuration;
      const stayRangeIndex = getStayRangeIndex(currentSimTime);
      if (stayRangeIndex === -1) {
        activeStayRangeIndexRef.current = -1;
      } else if (stayRangeIndex !== activeStayRangeIndexRef.current) {
        // Pause only once when entering a stay range. Without remembering the
        // active range, playback pauses again on every resumed frame and
        // appears to be stuck for the full duration of the stay point.
        activeStayRangeIndexRef.current = stayRangeIndex;
        isStayPausedRef.current = true;
        const pauseDuration = 1500 / speedRef.current;
        const ranges = replayStayRangesRef.current ?? stayRanges.current;
        const resumeProgress = getProgressAtTime(points, ranges[stayRangeIndex].end);
        stayPauseTimeoutRef.current = setTimeout(() => {
          isStayPausedRef.current = false;
          if (stateRef.current === "playing") {
            // A stay is represented by a short, intentional pause. Do not then
            // spend its full real-world duration replaying stationary GPS noise.
            updatePosition(Math.max(progressRef.current, resumeProgress));
            if (progressRef.current >= 1) {
              stateRef.current = "idle";
              setState("idle");
              return;
            }
            lastFrameTimeRef.current = performance.now();
            rafRef.current = requestAnimationFrame(animationLoop);
          }
        }, pauseDuration);
        return;
      }

      rafRef.current = requestAnimationFrame(animationLoop);
    },
    [updatePosition, getStayRangeIndex]
  );

  const play = useCallback(() => {
    if (sortedPoints.current.length < 2) return;

    // If we were idle, start from 0
    if (stateRef.current === "idle") {
      activeStayRangeIndexRef.current = -1;
      // Keep a stable snapshot for this run so today's one-minute polling does
      // not move the endpoint or reset an in-flight replay.
      replayPointsRef.current = [...sortedPoints.current];
      replayStayRangesRef.current = [...stayRanges.current];
      updatePosition(0);
    }

    stateRef.current = "playing";
    setState("playing");
    isStayPausedRef.current = false;
    lastFrameTimeRef.current = performance.now();
    rafRef.current = requestAnimationFrame(animationLoop);
  }, [animationLoop, updatePosition]);

  const pause = useCallback(() => {
    stateRef.current = "paused";
    setState("paused");
    cancelAnimationFrame(rafRef.current);
    if (stayPauseTimeoutRef.current) {
      clearTimeout(stayPauseTimeoutRef.current);
      stayPauseTimeoutRef.current = null;
    }
    isStayPausedRef.current = false;
    activeStayRangeIndexRef.current = -1;
  }, []);

  const stop = useCallback(() => {
    stateRef.current = "idle";
    setState("idle");
    cancelAnimationFrame(rafRef.current);
    if (stayPauseTimeoutRef.current) {
      clearTimeout(stayPauseTimeoutRef.current);
      stayPauseTimeoutRef.current = null;
    }
    isStayPausedRef.current = false;
    activeStayRangeIndexRef.current = -1;
    replayPointsRef.current = null;
    replayStayRangesRef.current = null;
    progressRef.current = 0;
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
        activeStayRangeIndexRef.current = -1;
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(animationLoop);
      }
    },
    [updatePosition, animationLoop]
  );

  const setSpeed = useCallback((newSpeed: number) => {
    speedRef.current = newSpeed;
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
