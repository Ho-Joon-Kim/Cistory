/**
 * Label placement for the asset-trend chart: callouts and axis labels are
 * placed against the lines they annotate (value line, dashed cost line), each
 * other, and the chart bounds — not just against a fixed offset from a point.
 */

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface Pt {
  x: number;
  y: number;
}

/** Rendered width estimate for 12px chart text: Hangul ≈ 1em, mono digits ≈ 0.6em. */
export function labelWidth(text: string, px = 12): number {
  let em = 0;
  for (const ch of text) {
    if (/[ᄀ-ᇿ　-鿿가-힯]/u.test(ch)) em += 1;
    else if (ch === " ") em += 0.35;
    else em += 0.6;
  }
  return Math.ceil(em * px);
}

export function boxesOverlap(a: Box, b: Box, gap = 0): boolean {
  return a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;
}

/** Whether segment a→b passes through box `r` grown by `pad` (Liang–Barsky). */
export function segmentHitsBox(a: Pt, b: Pt, r: Box, pad = 2): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a.x - (r.x0 - pad)],
    [dx, r.x1 + pad - a.x],
    [-dy, a.y - (r.y0 - pad)],
    [dy, r.y1 + pad - a.y],
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

export function polylineHitsBox(points: readonly Pt[], r: Box, pad = 2): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (Math.max(a.x, b.x) < r.x0 - pad || Math.min(a.x, b.x) > r.x1 + pad) continue;
    if (segmentHitsBox(a, b, r, pad)) return true;
  }
  return false;
}

export interface CalloutPlacement {
  box: Box;
  /** Leader end on the box edge nearest the point. */
  leader: Pt;
}

/**
 * Places a callout of `w`×`h` near point `p`: tries offsets above and below at
 * three distances and three horizontal alignments, keeps it inside
 * [0, width]×[top, bottom], and picks the candidate that crosses no line and no
 * other label, nearest the point (on the preferred side first). Returns null
 * only when every candidate leaves the bounds.
 */
export function placeCallout(opts: {
  p: Pt;
  w: number;
  h: number;
  preferAbove: boolean;
  width: number;
  top: number;
  bottom: number;
  lines: readonly (readonly Pt[])[];
  /** Hard obstacles (other callouts): never overlapped. */
  avoid: readonly Box[];
  /** Soft obstacles (axis labels): overlapped only if nothing else fits. */
  soft?: readonly Box[];
}): CalloutPlacement | null {
  const { p, w, h, preferAbove, width, top, bottom, lines, avoid, soft = [] } = opts;
  let best: { cost: number; box: Box } | null = null;
  for (const above of [preferAbove, !preferAbove]) {
    for (const dist of [12, 26, 42, 60]) {
      const y0 = above ? p.y - dist - h : p.y + dist;
      for (const shift of [0.5, 0.15, 0.85, 0, 1]) {
        const x0 = Math.max(0, Math.min(width - w, p.x - w * shift));
        const box = { x0, x1: x0 + w, y0, y1: y0 + h };
        if (y0 < top || box.y1 > bottom) continue;
        if (avoid.some((b) => boxesOverlap(b, box, 2))) continue;
        let cost = dist + Math.abs((x0 + w / 2 - p.x) / 8) + (above === preferAbove ? 0 : 30);
        for (const line of lines) if (polylineHitsBox(line, box)) cost += 1000;
        if (soft.some((b) => boxesOverlap(b, box, 2))) cost += 200;
        if (!best || cost < best.cost) best = { cost, box };
      }
    }
  }
  if (!best) return null;
  const { box } = best;
  const lx = Math.max(box.x0 + 4, Math.min(box.x1 - 4, p.x));
  const ly = box.y1 <= p.y ? box.y1 : box.y0;
  return { box, leader: { x: lx, y: ly } };
}

/**
 * Indices of x-axis ticks: every point when they all fit, else evenly spaced
 * counting back from the latest point (so the newest date is always labelled
 * and the gaps are equal).
 */
export function axisTickIndices(n: number, maxLabels: number): number[] {
  if (n <= 0) return [];
  const max = Math.max(2, maxLabels);
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  // The densest even step that still fits `max` labels.
  let step = Math.max(1, Math.floor((n - 1) / (max - 1)));
  if (Math.floor((n - 1) / step) + 1 > max) step = Math.ceil((n - 1) / (max - 1));
  const out: number[] = [];
  for (let j = n - 1; j >= 0; j -= step) out.unshift(j);
  return out;
}

export interface AxisLabelPlacement {
  /** Text x (start-anchored at the left edge, end-anchored at the right). */
  x: number;
  anchor: "start" | "end";
  /** Text baseline, always just above the grid line it labels. */
  baseline: number;
  box: Box;
}

/**
 * Places a y-axis label of width `w` on its grid line at `y`. The label always
 * sits directly above its own line (never below — a label under its line reads
 * as the value of the line beneath), at the left edge, else the right edge;
 * when a data line crosses both spots the label is dropped rather than
 * painted over the data.
 */
export function placeAxisLabel(opts: {
  y: number;
  w: number;
  width: number;
  lines: readonly (readonly Pt[])[];
  /** Other boxes the label must not overlap (e.g. end labels). */
  avoid?: readonly Box[];
}): AxisLabelPlacement | null {
  const { y, w, width, lines, avoid = [] } = opts;
  const baseline = y - 4;
  const y0 = y - 13;
  const y1 = y - 1;
  const spots: Array<Pick<AxisLabelPlacement, "x" | "anchor"> & { box: Box }> = [
    { x: 0, anchor: "start", box: { x0: 0, x1: w, y0, y1 } },
    { x: width, anchor: "end", box: { x0: width - w, x1: width, y0, y1 } },
  ];
  for (const s of spots) {
    if (lines.some((l) => polylineHitsBox(l, s.box, 2))) continue;
    if (avoid.some((b) => boxesOverlap(b, s.box, 1))) continue;
    return { ...s, baseline };
  }
  return null;
}

/** The polyline's y at `x` (linear between vertices; clamped to the ends). */
export function yOnPolyline(line: readonly Pt[], x: number): number {
  if (x <= line[0].x) return line[0].y;
  for (let j = 1; j < line.length; j++) {
    if (line[j].x >= x) {
      const a = line[j - 1];
      const b = line[j];
      return a.y + ((b.y - a.y) * (x - a.x)) / Math.max(1e-6, b.x - a.x);
    }
  }
  return line[line.length - 1].y;
}

/** Nearest vertical distance from `mid` to the polyline across [x0, x1]. */
function verticalGap(line: readonly Pt[], x0: number, x1: number, mid: number): number {
  let d = Number.POSITIVE_INFINITY;
  for (let x = x0; x <= x1; x += 2) d = Math.min(d, Math.abs(mid - yOnPolyline(line, x)));
  return Math.min(d, Math.abs(mid - yOnPolyline(line, x1)));
}

/**
 * An end label (12px text, right-anchored at `x`, baseline `y`) that names the
 * `own` line: just below or above it at the right end, else slid left along it
 * (never past mid-chart). It touches neither line, clears `avoid`, and sits at
 * least 10px nearer its own line than the `other` one across its whole width,
 * so it can't read as naming the other series. Null → drop it.
 */
export function placeLineLabel(opts: {
  w: number;
  width: number;
  bottom: number;
  own: readonly Pt[];
  other: readonly Pt[];
  avoid: readonly Box[];
}): { x: number; y: number } | null {
  const { w, width, bottom, own, other, avoid } = opts;
  for (let x1 = width; x1 - w >= width * 0.5; x1 -= 12) {
    const x0 = x1 - w;
    const box = (ly: number): Box => ({ x0, x1, y0: ly - 12, y1: ly + 2 });
    const ownY = yOnPolyline(own, x0 + w / 2);
    for (const d of [16, -6, 30, -20]) {
      const ly = ownY + d;
      const b = box(ly);
      if (b.y0 < 0 || b.y1 >= bottom) continue;
      if (verticalGap(own, x0, x1, ly - 5) + 10 > verticalGap(other, x0, x1, ly - 5)) continue;
      if (avoid.some((o) => boxesOverlap(o, b, 1))) continue;
      if (polylineHitsBox(own, b, 1) || polylineHitsBox(other, b, 1)) continue;
      return { x: x1, y: ly };
    }
  }
  return null;
}
