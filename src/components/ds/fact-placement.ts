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

/**
 * Where an evidence popover opens relative to its trigger.
 *
 * - Side: away from the highlighted evidence — if the lit items sit mostly below
 *   the trigger, open above it, and vice versa. With nothing lit (or evidence
 *   level with the trigger), the caller's preferred side.
 * - Offset: clear the whole sentence on that side, so the popover doesn't cover
 *   the second line of a wrapped sentence (Radix still flips on collision).
 */
export function chooseFactPopoverPlacement({
  trigger,
  sentence,
  evidence,
  regions = [],
  preferred = "bottom",
}: {
  trigger: Rect;
  sentence: Rect;
  evidence: Rect[];
  /** Fallback when no lit evidence sits outside the sentence: the host's charts
   * (a chart that lights its evidence without `data-evidence` attributes still
   * shouldn't be covered by the popover explaining it). */
  regions?: Rect[];
  preferred?: "top" | "bottom";
}): { side: "top" | "bottom"; sideOffset: number } {
  let side = preferred;
  const outside = (list: Rect[]) =>
    list.filter((r) => !(r.top >= sentence.top - 1 && r.bottom <= sentence.bottom + 1));
  const litOutside = outside(evidence);
  const others = litOutside.length > 0 ? litOutside : outside(regions);
  if (others.length > 0) {
    const triggerMid = (trigger.top + trigger.bottom) / 2;
    let below = 0;
    let above = 0;
    for (const r of others) {
      const area = Math.max(1, (r.right - r.left) * (r.bottom - r.top));
      if ((r.top + r.bottom) / 2 > triggerMid) below += area;
      else above += area;
    }
    if (below > above) side = "top";
    else if (above > below) side = "bottom";
  }
  const clearance =
    side === "bottom" ? sentence.bottom - trigger.bottom : trigger.top - sentence.top;
  return { side, sideOffset: GAP + Math.min(MAX_OFFSET, Math.max(0, Math.round(clearance))) };
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
