import { describe, expect, it, vi } from "vitest";
import { focusOverviewSection } from "./section-focus";

describe("focusOverviewSection", () => {
  it("scrolls to and focuses the requested overview domain", () => {
    const section = { scrollIntoView: vi.fn(), focus: vi.fn() };
    const root = { querySelector: vi.fn(() => section) };

    expect(focusOverviewSection("health", root)).toBe(true);
    expect(root.querySelector).toHaveBeenCalledWith('[data-overview-slot="health"]');
    expect(section.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(section.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("does nothing when the requested domain is absent", () => {
    const root = { querySelector: vi.fn(() => null) };
    expect(focusOverviewSection("health", root)).toBe(false);
  });
});
