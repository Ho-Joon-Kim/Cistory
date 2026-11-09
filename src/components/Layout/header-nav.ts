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
}: {
  /** Item's left edge in scroll-content coordinates. */
  itemLeft: number;
  itemWidth: number;
  viewportWidth: number;
  scrollWidth: number;
  scrollLeft?: number;
  margin?: number;
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
  return Math.round(Math.min(max, Math.max(0, next)));
}

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
