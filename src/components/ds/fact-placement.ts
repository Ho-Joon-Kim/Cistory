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
  preferred = "bottom",
}: {
  trigger: Rect;
  sentence: Rect;
  evidence: Rect[];
  preferred?: "top" | "bottom";
}): { side: "top" | "bottom"; sideOffset: number } {
  let side = preferred;
  const others = evidence.filter(
    (r) => !(r.top >= sentence.top - 1 && r.bottom <= sentence.bottom + 1)
  );
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
