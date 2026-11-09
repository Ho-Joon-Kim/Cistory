"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { RouteDay } from "../detail-model";

export interface SketchLabel {
  key: string;
  lat: number;
  lon: number;
  text: string;
  /** anchor (default): ringed marker; station: small marker. */
  kind?: "anchor" | "station";
}

/** Faint context label (a city the route passes near); no marker. */
export interface SketchReference {
  name: string;
  lat: number;
  lon: number;
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
  references = [],
  highlight,
  minHeight = 360,
  maxHeight = 680,
  ariaLabel,
}: {
  days: RouteDay[];
  labels: SketchLabel[];
  references?: readonly SketchReference[];
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
  type Box = { x: number; y: number; w: number };
  const placed: Box[] = [];
  const free = (x: number, y: number, w: number, own?: Box) =>
    placed.every(
      (p) => p === own || Math.abs(p.y - y) > 14 || x + w < p.x - 4 || x > p.x + p.w + 4
    );
  const textWidth = (text: string, px: number) => text.length * px + 8;

  // Markers: one per spot (two saved places a few px apart read as one blob).
  const markers: { label: SketchLabel; x: number; y: number }[] = [];
  for (const label of labels) {
    const { x, y } = project(label);
    if (markers.some((m) => Math.hypot(m.x - x, m.y - y) < 10)) continue;
    markers.push({ label, x, y });
  }
  // Marker discs and the highlight callout are obstacles for every label.
  const discs = markers.map((m) => ({ x: m.x - 5, y: m.y, w: 10 }));
  placed.push(...discs);
  const hl = highlight ? project(highlight) : null;
  if (hl) placed.push({ x: hl.x - 5, y: hl.y, w: 10 });

  // Saved places first: they always get a name (right, left, above, below —
  // the first free spot, else right anyway since text draws on top). Stations
  // are optional context: no free spot, no label and no marker.
  const ordered = markers
    .map((m, i) => ({ ...m, disc: discs[i] }))
    .sort((p, q) => (p.label.kind === "station" ? 1 : 0) - (q.label.kind === "station" ? 1 : 0));
  const markerText = ordered.flatMap((m) => {
    const w = textWidth(m.label.text, 12);
    type Spot = { tx: number; ty: number; anchor: "start" | "end" | "middle"; box: number };
    const spots: Spot[] = (
      [
        { tx: m.x + 8, ty: m.y + 4, anchor: "start", box: m.x + 8 },
        { tx: m.x - 8, ty: m.y + 4, anchor: "end", box: m.x - 8 - w },
        { tx: m.x, ty: m.y - 9, anchor: "middle", box: m.x - w / 2 },
        { tx: m.x, ty: m.y + 19, anchor: "middle", box: m.x - w / 2 },
      ] satisfies Spot[]
    ).filter((c) => c.box >= 4 && c.box + w <= width - 4 && c.ty > 12 && c.ty < height - 4);
    const spot = spots.find((c) => free(c.box, c.ty - 4, w, m.disc));
    const station = m.label.kind === "station";
    if (!spot && station) {
      placed.splice(placed.indexOf(m.disc), 1);
      return [];
    }
    const chosen: Spot = spot ??
      spots[0] ?? { tx: m.x + 8, ty: m.y + 4, anchor: "start", box: m.x + 8 };
    placed.push({ x: chosen.box, y: chosen.ty - 4, w });
    return [{ ...m, ...chosen }];
  });
  const drawn = new Set(markerText.map((m) => m.label.key));

  const refs = references
    .map((r) => ({ r, ...project(r) }))
    .filter((r) => r.x > 16 && r.x < width - 16 && r.y > 14 && r.y < height - 10)
    .filter((r) => !labels.some((l) => l.text.startsWith(r.r.name)))
    .flatMap((r) => {
      const w = textWidth(r.r.name, 11);
      const box = r.x - w / 2;
      if (box < 4 || box + w > width - 4 || !free(box, r.y, w)) return [];
      placed.push({ x: box, y: r.y, w });
      return [r];
    });

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
        {refs.map(({ r, x, y }) => (
          <text
            key={`ref-${r.name}`}
            x={x}
            y={y + 4}
            textAnchor="middle"
            className="fill-ink-3 text-[11px] tracking-[0.04em]"
            style={{ paintOrder: "stroke", stroke: "var(--sunken)", strokeWidth: 3 }}
          >
            {r.name}
          </text>
        ))}
        {markers
          .filter(({ label }) => drawn.has(label.key))
          .map(({ label, x, y }) =>
            label.kind === "station" ? (
              <rect
                key={label.key}
                x={x - 3.5}
                y={y - 3.5}
                width={7}
                height={7}
                rx={1.5}
                fill="var(--surface)"
                stroke="var(--ink2)"
                strokeWidth={1.5}
              />
            ) : (
              <circle
                key={label.key}
                cx={x}
                cy={y}
                r={4.5}
                fill="var(--surface)"
                stroke="var(--ink)"
                strokeWidth={1.8}
              />
            )
          )}
        {highlight
          ? (() => {
              const { x, y } = hl ?? project(highlight);
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
        {/* Label text last, so a marker or callout never covers a name. */}
        {markerText.map(({ label, tx, ty, anchor }) => (
          <text
            key={`t-${label.key}`}
            x={tx}
            y={ty}
            textAnchor={anchor}
            className={cn(
              "text-xs font-medium",
              label.kind === "station" ? "fill-ink-2" : "fill-ink"
            )}
            style={{ paintOrder: "stroke", stroke: "var(--sunken)", strokeWidth: 3 }}
          >
            {label.text}
          </text>
        ))}
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
