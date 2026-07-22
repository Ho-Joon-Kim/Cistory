interface OverviewSectionElement {
  scrollIntoView(options?: ScrollIntoViewOptions): void;
  focus(options?: FocusOptions): void;
}

interface OverviewSectionRoot {
  querySelector(selector: string): OverviewSectionElement | null;
}

export function focusOverviewSection(section: string, root: OverviewSectionRoot = document) {
  const target = root.querySelector(`[data-overview-slot="${section}"]`);
  if (!target) return false;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.focus({ preventScroll: true });
  return true;
}
