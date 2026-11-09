"use client";

import { useEffect, useRef, useState } from "react";
import type { RouteDay } from "../detail-model";

export interface SketchLabel {
  key: string;
  lat: number;
  lon: number;
  text: string;
}

export interface SketchHighlight {
  lat: number;
  lon: number;
  title: string;
  sub: string;
}

interface Point {
  lat: number;
  lon: number;
}

/** Equirectangular fit of lat/lon into a box (longitudes shrunk by cos(lat)). */
export function fitProjection(points: Point[], width: number, height: number, pad: number) {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max((maxLon - minLon) * k, 1e-6);
  const spanY = Math.max(maxLat - minLat, 1e-6);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  return (p: Point) => ({
    x: offX + (p.lon - minLon) * k * scale,
    y: offY + (maxLat - p.lat) * scale,
  });
}

/** Height a sketch wants for its data at a given width (portrait routes get taller). */
export function sketchHeight(points: Point[], width: number, min: number, max: number): number {
  if (points.length < 2) return min;
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const k = Math.cos((((Math.min(...lats) + Math.max(...lats)) / 2) * Math.PI) / 180);
  const spanX = Math.max((Math.max(...lons) - Math.min(...lons)) * k, 1e-6);
  const spanY = Math.max(Math.max(...lats) - Math.min(...lats), 1e-6);
  return Math.round(Math.min(max, Math.max(min, (width * spanY) / spanX)));
}

function pathOf(points: Point[], project: (p: Point) => { x: number; y: number }): string {
  return points
    .map((p, i) => {
      const { x, y } = project(p);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.round(el.getBoundingClientRect().width) || fallback);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fallback]);
  return { ref, width };
}

const STROKE: Record<RouteDay["role"], { color: string; width: number; dash?: string }> = {
  out: { color: "var(--place)", width: 2.5 },
  back: { color: "var(--ink2)", width: 2, dash: "5 4" },
  middle: { color: "var(--health)", width: 2 },
};

/**
 * The trip route drawn as a quiet SVG sketch (no tiles): the way out solid in
 * the place color, the way back dashed, days in between in the health color,
 * key stays labelled, and the hero day's walk called out.
 */
export function TripRouteSketch({
  days,
  labels,
  highlight,
  minHeight = 360,
  maxHeight = 680,
  ariaLabel,
}: {
  days: RouteDay[];
  labels: SketchLabel[];
  highlight?: SketchHighlight | null;
  minHeight?: number;
  maxHeight?: number;
  ariaLabel: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>(506);
  const all: Point[] = [...days.flatMap((d) => d.points), ...labels];
  if (all.length < 2) {
    return (
      <div className="grid h-60 place-items-center rounded-[14px] bg-sunken text-[13px] text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
        표시할 경로가 없어요
      </div>
    );
  }
  const height = sketchHeight(all, width, minHeight, maxHeight);
  const project = fitProjection(all, width, height, 40);
  const placed: { x: number; y: number; w: number }[] = [];
  const free = (x: number, y: number, w: number) =>
    placed.every((p) => Math.abs(p.y - y) > 14 || x + w < p.x - 4 || x > p.x + p.w + 4);

  return (
    <div ref={ref} className="w-full min-w-0">
      <svg
        width={width}
        height={height}
        style={{ width: "100%", height: "auto" }}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        className="block rounded-[14px] bg-sunken shadow-[inset_0_0_0_1px_var(--line)]"
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <g key={f}>
            <line x1={0} x2={width} y1={height * f} y2={height * f} stroke="var(--line)" />
            <line x1={width * f} x2={width * f} y1={0} y2={height} stroke="var(--line)" />
          </g>
        ))}
        {days.map((day) => {
          const s = STROKE[day.role];
          return (
            <path
              key={day.day}
              d={pathOf(day.points, project)}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width}
              strokeDasharray={s.dash}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
        {labels.map((label) => {
          const { x, y } = project(label);
          const w = label.text.length * 12 + 8;
          const right = x + 8 + w < width - 4;
          const tx = right ? x + 8 : x - 8;
          const show = free(right ? tx : tx - w, y, w);
          if (show) placed.push({ x: right ? tx : tx - w, y, w });
          return (
            <g key={label.key}>
              <circle
                cx={x}
                cy={y}
                r={4.5}
                fill="var(--surface)"
                stroke="var(--ink)"
                strokeWidth={1.8}
              />
              {show ? (
                <text
                  x={tx}
                  y={y + 4}
                  textAnchor={right ? "start" : "end"}
                  className="fill-ink text-xs font-medium"
                  style={{ paintOrder: "stroke", stroke: "var(--sunken)", strokeWidth: 3 }}
                >
                  {label.text}
                </text>
              ) : null}
            </g>
          );
        })}
        {highlight
          ? (() => {
              const { x, y } = project(highlight);
              const left = x > width / 2;
              const lx = left ? Math.max(12, x - 140) : Math.min(width - 12, x + 140);
              const ly = Math.max(28, y - 24);
              return (
                <g>
                  <line x1={x} y1={y} x2={lx} y2={ly + 4} stroke="var(--ink2)" strokeWidth={1} />
                  <circle cx={x} cy={y} r={5} fill="var(--health)" />
                  <text
                    x={lx + (left ? -4 : 4)}
                    y={ly - 10}
                    textAnchor={left ? "end" : "start"}
                    className="fill-ink text-xs font-semibold"
                    style={{ paintOrder: "stroke", stroke: "var(--sunken)", strokeWidth: 3 }}
                  >
                    {highlight.title}
                  </text>
                  <text
                    x={lx + (left ? -4 : 4)}
                    y={ly + 4}
                    textAnchor={left ? "end" : "start"}
                    className="num fill-ink-2 text-[11px]"
                    style={{ paintOrder: "stroke", stroke: "var(--sunken)", strokeWidth: 3 }}
                  >
                    {highlight.sub}
                  </text>
                </g>
              );
            })()
          : null}
      </svg>
    </div>
  );
}

/** Small single-color sketch of one walk (hero day): path + stop circles. */
export function WalkSketch({
  points,
  stops,
  ariaLabel,
  width = 200,
  height = 232,
}: {
  points: Point[];
  stops: Point[];
  ariaLabel: string;
  width?: number;
  height?: number;
}) {
  const all = [...points, ...stops];
  if (all.length < 2) return null;
  const project = fitProjection(all, width, height, 18);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      className="block rounded-xl bg-sunken shadow-[inset_0_0_0_1px_var(--line)]"
    >
      {points.length >= 2 ? (
        <path
          d={pathOf(points, project)}
          fill="none"
          stroke="var(--health)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.9}
        />
      ) : null}
      {stops.map((stop, i) => {
        const { x, y } = project(stop);
        return (
          <circle
            // biome-ignore lint/suspicious/noArrayIndexKey: stops are positional
            key={i}
            cx={x}
            cy={y}
            r={3}
            fill="var(--surface)"
            stroke="var(--health)"
            strokeWidth={1.5}
          />
        );
      })}
    </svg>
  );
}
