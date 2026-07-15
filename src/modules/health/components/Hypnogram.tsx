"use client";

import type { SleepStageKey, SleepStageSegment } from "@/modules/health/types";

/**
 * Sleep-stage display metadata. `lane` is the hypnogram row (0 = top / most awake,
 * 3 = bottom / deepest); `color` is a fixed identity hue tuned for the dark surface
 * — a night palette (deep indigo → light blue → REM violet → awake gray) distinct
 * from the other health metric accents.
 */
export const SLEEP_STAGE_META: Record<
  SleepStageKey,
  { label: string; color: string; lane: number }
> = {
  awake: { label: "각성", color: "hsl(0 0% 50%)", lane: 0 },
  rem: { label: "렘", color: "hsl(270 72% 70%)", lane: 1 },
  light: { label: "얕은잠", color: "hsl(207 84% 60%)", lane: 2 },
  deep: { label: "깊은잠", color: "hsl(235 66% 55%)", lane: 3 },
};

const LANE_ORDER: SleepStageKey[] = ["awake", "rem", "light", "deep"];

const W = 640;
const LABEL_W = 46;
const LANE_TOP = 6;
const LANE_H = 22;
const LANE_GAP = 5;
const AXIS_H = 22;

const laneY = (lane: number) => LANE_TOP + lane * (LANE_H + LANE_GAP);
const CHART_BOTTOM = laneY(3) + LANE_H;
const H = CHART_BOTTOM + AXIS_H;

/**
 * A single night's hypnogram — the classic stage timeline. Each stage span is a
 * colored block in its depth lane; deep/REM glow softly since they're the recovery
 * stages. The x-axis is elapsed sleep time; missing depths simply have empty lanes.
 */
export function Hypnogram({
  segments,
  minutes,
}: {
  segments: SleepStageSegment[];
  minutes: number;
}) {
  const total = Math.max(minutes, ...segments.map((s) => s.endMin), 1);
  const usable = W - LABEL_W;
  const xf = (min: number) => LABEL_W + (min / total) * usable;
  const hours = Math.ceil(total / 60);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="block h-auto w-full"
      style={{ overflow: "visible" }}
      role="img"
      aria-label="수면 단계 타임라인"
    >
      <title>수면 단계 타임라인</title>

      {/* lane baselines + labels */}
      {LANE_ORDER.map((key) => {
        const meta = SLEEP_STAGE_META[key];
        return (
          <g key={`lane-${key}`}>
            <rect
              x={LABEL_W}
              y={laneY(meta.lane)}
              width={usable}
              height={LANE_H}
              rx={4}
              fill="hsl(0 0% 100% / 0.025)"
            />
            <text
              x={2}
              y={laneY(meta.lane) + LANE_H / 2 + 3}
              fill="hsl(var(--ink-mute))"
              fontSize={9}
            >
              {meta.label}
            </text>
          </g>
        );
      })}

      {/* hour gridlines + ticks */}
      {Array.from({ length: hours + 1 }, (_, i) => i).map((h) => {
        const x = xf(h * 60);
        return (
          <g key={`hour-${h}`}>
            <line
              x1={x}
              y1={LANE_TOP}
              x2={x}
              y2={CHART_BOTTOM}
              stroke="hsl(0 0% 100% / 0.04)"
              strokeWidth={1}
            />
            <text
              x={x}
              y={CHART_BOTTOM + 15}
              fill="hsl(var(--ink-mute))"
              fontSize={8.5}
              textAnchor="middle"
              className="tabular-mono"
            >
              {h}h
            </text>
          </g>
        );
      })}

      {/* stage blocks */}
      {segments.map((seg) => {
        const meta = SLEEP_STAGE_META[seg.stage];
        const x = xf(seg.startMin);
        const w = Math.max(1, ((seg.endMin - seg.startMin) / total) * usable);
        const recovery = seg.stage === "deep" || seg.stage === "rem";
        return (
          <rect
            key={`${seg.stage}-${seg.startMin}-${seg.endMin}`}
            x={x}
            y={laneY(meta.lane)}
            width={w}
            height={LANE_H}
            rx={2}
            fill={meta.color}
            filter={recovery ? `drop-shadow(0 0 3px ${meta.color})` : undefined}
          >
            <title>{`${meta.label} · ${Math.round(seg.startMin)}~${Math.round(seg.endMin)}분`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
