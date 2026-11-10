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

type Rect = { x: number; y: number; w: number; h: number };
type Segment = [{ x: number; y: number }, { x: number; y: number }];

/**
 * Approximate rendered width of a label: Hangul/CJK glyphs are about one em,
 * Latin letters and digits a little over half, punctuation and spaces less.
 */
export function textWidth(text: string, px: number): number {
  let em = 0;
  for (const ch of text) {
    if (/[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af]/u.test(ch)) em += 1;
    else if (/[\s·.,:'()-]/u.test(ch)) em += 0.32;
    else em += 0.6;
  }
  return Math.ceil(em * px) + 2;
}

function discRect(x: number, y: number): Rect {
  return { x: x - 6, y: y - 6, w: 12, h: 12 };
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap
  );
}

/** Whether a segment passes through (or ends inside) a rect, padded by 1.5px for the stroke. */
export function crosses([a, b]: Segment, r: Rect): boolean {
  const pad = 1.5;
  const x0 = r.x - pad;
  const x1 = r.x + r.w + pad;
  const y0 = r.y - pad;
  const y1 = r.y + r.h + pad;
  // Liang–Barsky clip of the segment against the rect.
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a.x - x0],
    [dx, x1 - a.x],
    [-dy, a.y - y0],
    [dy, y1 - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t0 <= t1;
}

type Spot = { tx: number; ty: number; anchor: "start" | "end" | "middle"; rect: Rect };

/** Candidate label positions around a marker, nearest first, then a step further out. */
function labelSpots(x: number, y: number, w: number): Spot[] {
  const h = 14;
  const spots: Spot[] = [];
  for (const d of [0, 10]) {
    const right = x + 8 + d;
    const left = x - 8 - d;
    spots.push(
      { tx: right, ty: y + 4, anchor: "start", rect: { x: right, y: y - 7, w, h } },
      { tx: left, ty: y + 4, anchor: "end", rect: { x: left - w, y: y - 7, w, h } },
      { tx: x, ty: y - 9 - d, anchor: "middle", rect: { x: x - w / 2, y: y - 20 - d, w, h } },
      { tx: x, ty: y + 19 + d, anchor: "middle", rect: { x: x - w / 2, y: y + 8 + d, w, h } },
      { tx: right, ty: y - 6 - d, anchor: "start", rect: { x: right, y: y - 17 - d, w, h } },
      { tx: left, ty: y - 6 - d, anchor: "end", rect: { x: left - w, y: y - 17 - d, w, h } },
      { tx: right, ty: y + 14 + d, anchor: "start", rect: { x: right, y: y + 3 + d, w, h } },
      { tx: left, ty: y + 14 + d, anchor: "end", rect: { x: left - w, y: y + 3 + d, w, h } }
    );
  }
  return spots;
}

/**
 * The hero-day callout: a two-line note up and to the open side of its point,
 * with the text block clamped inside the sketch (a narrow phone sketch used to
 * push it past the left edge) and the leader drawn to the block's near edge.
 */
export function placeCallout(
  p: { x: number; y: number },
  h: { title: string; sub: string },
  width: number,
  height: number
) {
  const w = Math.max(textWidth(h.title, 12), textWidth(h.sub, 11));
  const reach = Math.min(140, Math.max(40, width / 3));
  const left = p.x > width / 2;
  const ly = Math.min(height - 8, Math.max(28, p.y - 24));
  const ideal = left ? p.x - reach - w : p.x + reach;
  const textX = Math.max(8, Math.min(width - 8 - w, ideal));
  const nearEdge = textX + w < p.x ? textX + w : textX > p.x ? textX : textX + w / 2;
  return {
    title: h.title,
    sub: h.sub,
    textX,
    titleY: ly - 10,
    subY: ly + 4,
    lineX: nearEdge,
    lineY: ly + 7,
    box: { x: textX - 2, y: ly - 22, w: w + 4, h: 30 } satisfies Rect,
  };
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
  // Route polylines in screen space: labels are placed off them, not just off
  // each other, so no route line strikes through a name.
  const segments: Segment[] = days.flatMap((day) => {
    const pts = day.points.map(project);
    return pts.slice(1).map((b, i) => [pts[i], b] as Segment);
  });
  const placed: Rect[] = [];
  const hitsLabel = (r: Rect, own?: Rect) => placed.some((p) => p !== own && overlaps(p, r, 3));
  const routeHits = (r: Rect) => segments.reduce((n, sg) => n + (crosses(sg, r) ? 1 : 0), 0);

  // Markers: one per spot (two saved places a few px apart read as one blob).
  // Labels arrive in priority order (home first), so the earlier one names it.
  const markers: { label: SketchLabel; x: number; y: number }[] = [];
  for (const label of labels) {
    const { x, y } = project(label);
    if (markers.some((m) => Math.hypot(m.x - x, m.y - y) < 10)) continue;
    markers.push({ label, x, y });
  }
  // Marker discs and the highlight callout are obstacles for every label.
  const discs = markers.map((m) => discRect(m.x, m.y));
  placed.push(...discs);
  const hl = highlight ? project(highlight) : null;
  const callout = hl && highlight ? placeCallout(hl, highlight, width, height) : null;
  if (hl) placed.push(discRect(hl.x, hl.y));
  if (callout && hl) {
    placed.push(callout.box);
    // The leader is a line like any route: no name sits across it.
    segments.push([hl, { x: callout.lineX, y: callout.lineY }]);
  }

  // Saved places first: they always get a name (the free spot crossing the
  // fewest route lines, else the first spot since text draws on top). Stations
  // are optional context: no spot clear of labels and routes, no label and no
  // marker.
  const ordered = markers
    .map((m, i) => ({ ...m, disc: discs[i] }))
    .sort((p, q) => (p.label.kind === "station" ? 1 : 0) - (q.label.kind === "station" ? 1 : 0));
  const markerText = ordered.flatMap((m) => {
    const w = textWidth(m.label.text, 12);
    const spots = labelSpots(m.x, m.y, w).filter(
      (c) =>
        c.rect.x >= 4 &&
        c.rect.x + w <= width - 4 &&
        c.rect.y >= 2 &&
        c.rect.y + c.rect.h <= height - 2
    );
    const station = m.label.kind === "station";
    const scored = spots
      .filter((c) => !hitsLabel(c.rect, m.disc))
      .map((c, i) => ({ c, cost: routeHits(c.rect) * 100 + i }))
      .sort((a, b) => a.cost - b.cost);
    const best = scored[0];
    if (station && (!best || best.cost >= 100)) {
      placed.splice(placed.indexOf(m.disc), 1);
      return [];
    }
    const chosen = best?.c ?? spots[0] ?? labelSpots(m.x, m.y, w)[0];
    placed.push(chosen.rect);
    return [{ ...m, tx: chosen.tx, ty: chosen.ty, anchor: chosen.anchor }];
  });
  const drawn = new Set(markerText.map((m) => m.label.key));

  // Reference cities are faint context: only where they clear every label and route.
  const refs = references
    .map((r) => ({ r, ...project(r) }))
    .filter((r) => r.x > 16 && r.x < width - 16 && r.y > 14 && r.y < height - 10)
    .filter((r) => !labels.some((l) => l.text.startsWith(r.r.name)))
    .flatMap((r) => {
      // A small dot at the city with its name to the right, as in the mock.
      const w = textWidth(r.r.name, 11) + 6;
      const rect = { x: r.x - 3, y: r.y - 7, w, h: 14 };
      if (rect.x < 4 || rect.x + w > width - 4 || hitsLabel(rect) || routeHits(rect) > 0) return [];
      placed.push(rect);
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
          <g key={`ref-${r.name}`}>
            <circle cx={x} cy={y} r={1.8} className="fill-ink-3" />
            <text
              x={x + 5}
              y={y + 4}
              className="fill-ink-3 text-[11px] tracking-[0.04em]"
              style={{ paintOrder: "stroke", stroke: "var(--sunken)", strokeWidth: 3 }}
            >
              {r.name}
            </text>
          </g>
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
        {hl && callout ? (
          <g>
            <line
              x1={hl.x}
              y1={hl.y}
              x2={callout.lineX}
              y2={callout.lineY}
              stroke="var(--ink2)"
              strokeWidth={1}
            />
            <circle cx={hl.x} cy={hl.y} r={5} fill="var(--health)" />
            <text
              x={callout.textX}
              y={callout.titleY}
              className="fill-ink text-xs font-semibold"
              style={{ paintOrder: "stroke", stroke: "var(--sunken)", strokeWidth: 3 }}
            >
              {callout.title}
            </text>
            <text
              x={callout.textX}
              y={callout.subY}
              className="num fill-ink-2 text-[11px]"
              style={{ paintOrder: "stroke", stroke: "var(--sunken)", strokeWidth: 3 }}
            >
              {callout.sub}
            </text>
          </g>
        ) : null}
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
