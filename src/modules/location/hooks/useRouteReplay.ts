"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LocationData, StayPointData } from "../hooks";
import type { ReplayFrame, ReplayTimeline } from "../replay-timeline";
import { buildReplayTimeline, getReplayFrame } from "../replay-timeline";

interface UseRouteReplayOptions {
  locations: LocationData[];
  stayPoints?: StayPointData[];
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
  subscribe: (listener: (frame: ReplayFrame) => void) => () => void;
}

const UI_UPDATE_INTERVAL_MS = 80;

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
  const latestTimelineRef = useRef<ReplayTimeline>({ durationMs: 0, events: [] });
  const activeTimelineRef = useRef<ReplayTimeline | null>(null);
  const rafRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const lastUiUpdateRef = useRef(0);
  const listenersRef = useRef(new Set<(frame: ReplayFrame) => void>());
  const animationLoopRef = useRef<(now: number) => void>(() => {});

  stateRef.current = state;
  progressRef.current = progress;
  speedRef.current = speed;

  useEffect(() => {
    latestTimelineRef.current = buildReplayTimeline(locations, stayPoints);
  }, [locations, stayPoints]);

  const publishFrame = useCallback((frame: ReplayFrame, forceUi = false) => {
    progressRef.current = frame.progress;
    for (const listener of listenersRef.current) listener(frame);

    const now = performance.now();
    if (forceUi || now - lastUiUpdateRef.current >= UI_UPDATE_INTERVAL_MS) {
      lastUiUpdateRef.current = now;
      setCurrentCoord(frame.coord);
      setCurrentTimestamp(frame.timestamp);
      setProgress(frame.progress);
    }
  }, []);

  const updatePosition = useCallback(
    (newProgress: number, forceUi = false) => {
      const timeline = activeTimelineRef.current ?? latestTimelineRef.current;
      const frame = getReplayFrame(timeline, newProgress);
      if (frame) publishFrame(frame, forceUi);
    },
    [publishFrame]
  );

  animationLoopRef.current = (now: number) => {
    if (stateRef.current !== "playing") return;
    const timeline = activeTimelineRef.current;
    if (!timeline || timeline.durationMs <= 0) return;

    const delta = now - lastFrameTimeRef.current;
    lastFrameTimeRef.current = now;
    const nextProgress = Math.min(
      1,
      progressRef.current + (delta * speedRef.current) / timeline.durationMs
    );
    updatePosition(nextProgress, nextProgress >= 1);

    if (nextProgress >= 1) {
      stateRef.current = "idle";
      setState("idle");
      return;
    }
    rafRef.current = requestAnimationFrame(animationLoopRef.current);
  };

  const play = useCallback(() => {
    if (latestTimelineRef.current.events.length === 0) return;
    if (stateRef.current === "idle") {
      activeTimelineRef.current = latestTimelineRef.current;
      updatePosition(0, true);
    }

    stateRef.current = "playing";
    setState("playing");
    lastFrameTimeRef.current = performance.now();
    rafRef.current = requestAnimationFrame(animationLoopRef.current);
  }, [updatePosition]);

  const pause = useCallback(() => {
    stateRef.current = "paused";
    setState("paused");
    cancelAnimationFrame(rafRef.current);
    updatePosition(progressRef.current, true);
  }, [updatePosition]);

  const stop = useCallback(() => {
    stateRef.current = "idle";
    setState("idle");
    cancelAnimationFrame(rafRef.current);
    activeTimelineRef.current = null;
    progressRef.current = 0;
    setProgress(0);
    setCurrentCoord(null);
    setCurrentTimestamp(null);
  }, []);

  const seek = useCallback(
    (newProgress: number) => {
      const clamped = Math.min(1, Math.max(0, newProgress));
      if (!activeTimelineRef.current) activeTimelineRef.current = latestTimelineRef.current;
      updatePosition(clamped, true);
      if (stateRef.current === "playing") {
        lastFrameTimeRef.current = performance.now();
      }
    },
    [updatePosition]
  );

  const setSpeed = useCallback((newSpeed: number) => {
    speedRef.current = newSpeed;
    setSpeedState(newSpeed);
  }, []);

  const subscribe = useCallback((listener: (frame: ReplayFrame) => void) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);

  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
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
    subscribe,
  };
}
