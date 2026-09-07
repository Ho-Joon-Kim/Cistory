import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Timeline } from "./Timeline";

vi.mock("@/modules/location/hooks", () => ({
  useDailyDistances: () => ({ distances: {} }),
  useTracks: () => ({ tracks: [] }),
  useStayPoints: () => ({ stayPoints: [] }),
}));
vi.mock("@/modules/wakatime/hooks", () => ({
  useCodingStats: () => ({ stats: [] }),
  useCodingSessions: () => ({ sessions: [] }),
}));
vi.mock("../hooks", () => ({
  useTransactionsForDate: () => ({
    transactions: [
      {
        id: "tx",
        type: "withdrawal",
        amount: 1200,
        merchant: "생활 기록 카페",
        accountName: "카드",
        transactedAt: "2026-09-06T10:00:00+09:00",
      },
    ],
    isLoading: false,
    error: null,
  }),
}));
afterEach(() => vi.useRealTimers());

describe("life timeline without commits", () => {
  it("renders the selected historical date and its spending even when GitHub is empty", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T10:00:00+09:00"));
    const markup = renderToStaticMarkup(
      createElement(Timeline, {
        commits: [],
        isLoading: false,
        hasNext: false,
        onLoadMore: vi.fn(),
        selectedDate: "2026-09-06",
        onSelectedDateChange: vi.fn(),
      })
    );
    expect(markup).toContain("생활 기록 카페");
    expect(markup).toContain("1,200");
    expect(markup).not.toContain("레포지토리를 추적하면");
  });
});
