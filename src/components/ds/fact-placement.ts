export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Page gutter at a viewport width (mirrors the `px-page` utility). */
export function pageGutter(viewportWidth: number): number {
  if (viewportWidth >= 1400) return 96;
  if (viewportWidth >= 1024) return 24;
  return 16;
}

const GAP = 6;
/** Never push the popover further than this from its trigger. */
const MAX_OFFSET = 96;

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Default popover footprint used when the caller has no better estimate. */
const DEFAULT_POP_W = 320;
const DEFAULT_POP_H = 160;
/** Slack around the estimated footprint (wrapping rows, Radix shift). */
const FOOTPRINT_SLACK = 16;
/** How far beyond the popover's reach a rect still steers the side. */
const NEAR_PX = 120;

/**
 * Where an evidence popover opens relative to its trigger.
 *
 * Side, in priority order — each tier only counts rects the popover could
 * actually reach (its estimated footprint on that side), never things far away:
 * 1. Lit evidence (`evidence`): a popover never covers its own highlighted data
 *    when the other side is clear of it.
 * 2. The host's charts / `data-evidence-avoid` regions (`regions`).
 * 3. Other chart-annotation labels (`labels`) — least important.
 * When both sides cost the same, the side away from nearby lit evidence (else
 * nearby regions) wins, so "open away from the evidence" still holds when
 * neither footprint touches it; with nothing near, the caller's preferred side.
 *
 * Offset: clear the whole sentence on that side, so the popover doesn't cover
 * the second line of a wrapped sentence (Radix still flips on collision).
 */
export function chooseFactPopoverPlacement({
  trigger,
  sentence,
  evidence,
  regions = [],
  labels = [],
  preferred = "bottom",
  popover = { width: DEFAULT_POP_W, height: DEFAULT_POP_H },
  viewportWidth,
}: {
  trigger: Rect;
  sentence: Rect;
  /** Rects of the fact's own lit evidence. */
  evidence: Rect[];
  /** The host's charts (a chart that lights its evidence without
   * `data-evidence` attributes still shouldn't be covered by the popover). */
  regions?: Rect[];
  /** Other chart-annotation labels on the page. */
  labels?: Rect[];
  preferred?: "top" | "bottom";
  /** Estimated popover size. */
  popover?: { width: number; height: number };
  /** Clamp the footprint inside the page gutters when known. */
  viewportWidth?: number;
}): { side: "top" | "bottom"; sideOffset: number } {
  const outside = (list: Rect[]) =>
    list.filter((r) => !(r.top >= sentence.top - 1 && r.bottom <= sentence.bottom + 1));
  const lit = outside(evidence);
  const charts = outside(regions);
  const marks = outside(labels);

  const offsetFor = (side: "top" | "bottom") => {
    const clearance =
      side === "bottom" ? sentence.bottom - trigger.bottom : trigger.top - sentence.top;
    return GAP + Math.min(MAX_OFFSET, Math.max(0, Math.round(clearance)));
  };

  let left = trigger.left;
  if (viewportWidth) {
    const gutter = pageGutter(viewportWidth);
    left = Math.max(gutter, Math.min(left, viewportWidth - gutter - popover.width));
  }
  const footprint = (side: "top" | "bottom"): Rect => {
    const h = popover.height + FOOTPRINT_SLACK;
    const edge =
      side === "bottom" ? trigger.bottom + offsetFor("bottom") : trigger.top - offsetFor("top");
    return {
      left: left - FOOTPRINT_SLACK,
      right: left + popover.width + FOOTPRINT_SLACK,
      top: side === "bottom" ? edge : edge - h,
      bottom: side === "bottom" ? edge + h : edge,
    };
  };
  const cost = (side: "top" | "bottom") => {
    const f = footprint(side);
    const sum = (list: Rect[]) => list.reduce((acc, r) => acc + overlapArea(f, r), 0);
    // Tiers can't trade off: any lit overlap outweighs every chart and label.
    return [sum(lit), sum(charts), sum(marks)];
  };
  const below = cost("bottom");
  const above = cost("top");
  let side = preferred;
  const tier = below.findIndex((v, i) => v !== above[i]);
  if (tier >= 0) {
    side = below[tier] < above[tier] ? "bottom" : "top";
  } else {
    // Neither footprint decides: steer away from what is near the sentence.
    const reach = popover.height + NEAR_PX;
    const near = (list: Rect[]) =>
      list.filter((r) => r.top < sentence.bottom + reach && r.bottom > sentence.top - reach);
    const nearLit = near(lit);
    const others = nearLit.length > 0 ? nearLit : near(charts);
    const triggerMid = (trigger.top + trigger.bottom) / 2;
    let down = 0;
    let up = 0;
    for (const r of others) {
      const area = Math.max(1, (r.right - r.left) * (r.bottom - r.top));
      if ((r.top + r.bottom) / 2 > triggerMid) down += area;
      else up += area;
    }
    if (down > up) side = "top";
    else if (up > down) side = "bottom";
  }
  return { side, sideOffset: offsetFor(side) };
}

/** Narrowest column the popover is squeezed into before it may overflow it. */
const MIN_COLUMN = 260;

/**
 * Horizontal room for the popover: the page gutters, narrowed to the host column
 * when the host is a column of a multi-column row (so a popover in the middle
 * column doesn't spill over the next column's chart). Returns viewport-relative
 * collision padding plus a max width when the column is the binding limit.
 */
export function factPopoverBounds({
  viewportWidth,
  column,
}: {
  viewportWidth: number;
  column?: Rect | null;
}): { left: number; right: number; maxWidth: number | null } {
  const gutter = pageGutter(viewportWidth);
  let left = gutter;
  let right = viewportWidth - gutter;
  if (column) {
    const l = Math.max(left, Math.round(column.left));
    const r = Math.min(right, Math.round(column.right));
    // Only a real column (narrower than the content area) and wide enough to read in.
    if (r - l >= MIN_COLUMN && r - l < right - left - 1) {
      left = l;
      right = r;
      return { left, right: viewportWidth - right, maxWidth: right - left };
    }
  }
  return { left, right: viewportWidth - right, maxWidth: null };
}

/** Rough evidence-popover height before it renders (title, rows, note, padding). */
export function estimateFactPopoverHeight(rows: number, hasNote: boolean): number {
  return 28 + 26 + rows * 24 + (hasNote ? 30 : 0) + 12;
}

/**
 * How far to scroll the page (px, positive = down) so a popover of `height`
 * fits on its chosen side. Without it, a fact near the viewport edge makes
 * Radix flip the popover onto the very evidence the side was chosen to avoid.
 * Never scrolls the trigger itself out of the viewport; 0 when it already fits
 * or can't be made to.
 */
export function scrollToFitPopover({
  side,
  sideOffset,
  trigger,
  height,
  viewportHeight,
  margin = 16,
}: {
  side: "top" | "bottom";
  sideOffset: number;
  trigger: Rect;
  height: number;
  viewportHeight: number;
  margin?: number;
}): number {
  if (side === "bottom") {
    const need = trigger.bottom + sideOffset + height + margin - viewportHeight;
    if (need <= 0) return 0;
    const room = trigger.top - margin;
    return need <= room ? Math.ceil(need) : 0;
  }
  const need = margin - (trigger.top - sideOffset - height);
  if (need <= 0) return 0;
  const room = viewportHeight - margin - trigger.bottom;
  return need <= room ? -Math.ceil(need) : 0;
}
