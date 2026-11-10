import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "./page";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/components/Layout/Header", () => ({ Header: () => null }));
vi.mock("@/modules/auth/hooks", () => ({
  useRequireAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));
vi.mock("@/modules/settings/hooks", () => ({ useSettings: () => ({ settings: null }) }));
vi.mock("@/modules/sync/hooks", () => ({
  SyncStatusProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/modules/timeline/components/day/DayView", () => ({
  DayView: ({ notice }: { notice: unknown }) =>
    createElement("div", { "data-testid": "day" }, notice as never),
}));
vi.mock("@/modules/timeline/hooks", () => ({
  useRepositories: () => ({ repositories: [], isLoading: false, error: null, refresh: () => {} }),
  startInitialSync: vi.fn(),
}));
afterEach(() => vi.unstubAllGlobals());

describe("dashboard without GitHub records", () => {
  it("keeps the day view with the optional GitHub sync notice", () => {
    const markup = renderToStaticMarkup(createElement(DashboardPage));
    expect(markup).toContain('data-testid="day"');
    expect(markup).toContain("생활 기록은 아래에서 확인");
  });
});
