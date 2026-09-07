import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "./page";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("next/dynamic", () => ({
  default: () => () => createElement("div", { "data-testid": "map" }),
}));
vi.mock("@/components/Layout/Header", () => ({ Header: () => null }));
vi.mock("@/modules/auth/hooks", () => ({
  useRequireAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));
vi.mock("@/modules/settings/hooks", () => ({ useSettings: () => ({ settings: null }) }));
vi.mock("@/modules/sync/hooks", () => ({
  SyncStatusProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/modules/timeline/components/Timeline", () => ({
  Timeline: () => createElement("div", { "data-testid": "timeline" }),
}));
vi.mock("@/modules/timeline/hooks", () => ({
  useTimeline: () => ({ commits: [], isLoading: false, hasNext: false }),
  useRepositories: () => ({ repositories: [], isLoading: false }),
}));
afterEach(() => vi.unstubAllGlobals());

describe("dashboard without GitHub records", () => {
  it("keeps map and timeline beside the optional GitHub sync notice", () => {
    const markup = renderToStaticMarkup(createElement(DashboardPage));
    expect(markup).toContain('data-testid="map"');
    expect(markup).toContain('data-testid="timeline"');
    expect(markup).toContain("생활 기록은 아래에서 확인");
  });
});
