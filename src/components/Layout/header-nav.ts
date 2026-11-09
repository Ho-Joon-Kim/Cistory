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

/**
 * scrollLeft that centres a nav item in the mobile pill strip, clamped to the
 * scrollable range (the first items stay flush left, the last flush right).
 */
export function navScrollLeftFor({
  itemLeft,
  itemWidth,
  viewportWidth,
  scrollWidth,
}: {
  itemLeft: number;
  itemWidth: number;
  viewportWidth: number;
  scrollWidth: number;
}): number {
  const max = Math.max(0, scrollWidth - viewportWidth);
  const centred = itemLeft + itemWidth / 2 - viewportWidth / 2;
  return Math.round(Math.min(max, Math.max(0, centred)));
}
