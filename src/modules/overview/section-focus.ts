import { prefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";

interface OverviewSectionElement {
  scrollIntoView(options?: ScrollIntoViewOptions): void;
  focus(options?: FocusOptions): void;
}

interface OverviewSectionRoot {
  querySelector(selector: string): OverviewSectionElement | null;
}

export function focusOverviewSection(
  section: string,
  root: OverviewSectionRoot = document,
  reducedMotion: boolean = prefersReducedMotion()
) {
  const target = root.querySelector(`[data-overview-slot="${section}"]`);
  if (!target) return false;
  // An explicit `behavior` bypasses the CSS reduced-motion override, so honor it here.
  target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  target.focus({ preventScroll: true });
  return true;
}
