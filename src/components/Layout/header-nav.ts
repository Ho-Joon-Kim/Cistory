/** App-bar navigation, in the fixed order every page shows. */
export const HEADER_NAV_ITEMS = [
  { id: "timeline", href: "/dashboard", label: "타임라인" },
  { id: "overview", href: "/overview", label: "개요" },
  { id: "spending", href: "/spending", label: "소비" },
  { id: "portfolio", href: "/portfolio", label: "포트폴리오" },
  { id: "travel", href: "/travel", label: "여행" },
  { id: "health", href: "/health", label: "건강" },
  { id: "search", href: "/search", label: "검색" },
] as const;

export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Width of the mobile strip's edge fade; a revealed pill clears it. */
export const NAV_FADE_PX = 20;

/**
 * scrollLeft that brings a nav item into the mobile pill strip with the least
 * movement: a pill already clear of the edge fades stays put (so a page whose
 * pill fits starts at the first tab, as in the mocks); otherwise the strip
 * scrolls just far enough for the pill to clear the fade, clamped to the
 * scrollable range (the first items stay flush left, the last flush right).
 */
export function navScrollLeftFor({
  itemLeft,
  itemWidth,
  viewportWidth,
  scrollWidth,
  scrollLeft = 0,
  margin = NAV_FADE_PX,
  items = [],
  pad = NAV_PILL_PAD_PX,
}: {
  /** Item's left edge in scroll-content coordinates. */
  itemLeft: number;
  itemWidth: number;
  viewportWidth: number;
  scrollWidth: number;
  scrollLeft?: number;
  margin?: number;
  /** Every pill in the strip (scroll-content coordinates), in order. With it, a
   * pill left half-cut at the left edge — its label sliced by the edge rather
   * than just its padding under the fade — is scrolled fully away instead. */
  items?: ReadonlyArray<{ left: number; width: number }>;
  /** A pill's horizontal padding (its label starts this far in). */
  pad?: number;
}): number {
  const max = Math.max(0, scrollWidth - viewportWidth);
  let next = scrollLeft;
  if (itemLeft - margin < next) next = itemLeft - margin;
  else if (itemLeft + itemWidth + margin > next + viewportWidth)
    next = itemLeft + itemWidth + margin - viewportWidth;
  // Within a fade's width of either end, go all the way (no sliver of padding) —
  // unless that would push the pill back under the opposite edge's fade.
  if (next < margin && itemLeft + itemWidth + margin <= viewportWidth) next = 0;
  else if (max - next < margin && itemLeft - margin >= max) next = max;
  next = Math.min(max, Math.max(0, next));
  if (next > 0 && next < max) {
    // A label sliced by the left edge reads as a clipped word, not as "more
    // this way": snap so that pill's label is gone and the next pill's label
    // clears the fade.
    const cut = items.findIndex(
      (it) => it.left + pad < next + margin && it.left + it.width - pad > next
    );
    const after = cut >= 0 ? items[cut + 1] : undefined;
    if (after && after.left - pad > next && after.left <= itemLeft) {
      next = Math.min(max, after.left - pad);
    }
  }
  return Math.round(next);
}

/** Horizontal padding of a nav pill (`px-3`). */
export const NAV_PILL_PAD_PX = 12;

/** Which edges of a horizontally scrolled strip have hidden content. */
export function navEdges({
  scrollLeft,
  clientWidth,
  scrollWidth,
}: {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}): { left: boolean; right: boolean } {
  return {
    left: scrollLeft > 1,
    right: scrollLeft + clientWidth < scrollWidth - 1,
  };
}

/** Widest the left fade grows to swallow a label sliced by the left edge. */
export const NAV_FADE_MAX_PX = 48;

/**
 * The left edge fade: `clear` px fully transparent, then a ramp to opaque at
 * `fade` px. Normally no clear zone and a {@link NAV_FADE_PX} ramp. When the
 * strip is scrolled to its end and the pill at the left edge still shows part
 * of its label (nothing further to scroll), that sliver is cleared and the ramp
 * runs over the pill's trailing padding — a clipped word ("라인") never shows.
 */
export function navLeftFadeFor({
  items,
  scrollLeft,
  pad = NAV_PILL_PAD_PX,
}: {
  /** Pills in scroll-content coordinates, in order. */
  items: ReadonlyArray<{ left: number; width: number }>;
  scrollLeft: number;
  pad?: number;
}): { clear: number; fade: number } {
  const plain = { clear: 0, fade: NAV_FADE_PX };
  const cut = items.find((it) => it.left < scrollLeft && it.left + it.width > scrollLeft);
  if (!cut) return plain;
  const labelEnd = Math.round(cut.left + cut.width - pad - scrollLeft);
  if (labelEnd <= 0) return plain;
  const clear = Math.min(NAV_FADE_MAX_PX - pad, labelEnd);
  return { clear, fade: Math.max(NAV_FADE_PX, clear + pad) };
}
