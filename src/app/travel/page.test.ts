import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  TravelListView,
  type TravelListViewProps,
} from "@/modules/travel/components/TravelListView";
import type { TravelTripListItem } from "@/modules/travel/hooks";

function trip(
  id: string,
  name: string,
  start: string,
  end: string,
  extra: Partial<TravelTripListItem> = {}
): TravelTripListItem {
  return {
    id,
    userId: "user-1",
    name,
    startDate: start,
    endDate: end,
    totalDistanceMeters: 300_000,
    visitedCities: ["대전"],
    visitedCountries: [],
    isOverseas: false,
    autoDetected: true,
    notes: null,
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
    totalSpending: 100_000,
    visitCount: 12,
    anchorPlaceName: null,
    ...extra,
  };
}

function render(props: Partial<TravelListViewProps>): string {
  return renderToStaticMarkup(
    createElement(TravelListView, {
      trips: [],
      summary: null,
      today: "2026-11-10",
      isLoading: false,
      error: null,
      hasMore: false,
      loadMore: vi.fn(),
      refresh: vi.fn(),
      scheduleNotTrip: vi.fn(),
      undoNotTrip: vi.fn(),
      renameTrip: vi.fn(),
      ...props,
    })
  );
}

describe("TravelListView", () => {
  it("renders the empty state when there are no trips", () => {
    expect(render({})).toContain("아직 기록된 여행이 없어요");
  });

  it("renders the year hero, highlights, a recurring group and 기록 없음 before Toss data", () => {
    const dj = ["2026-09-23", "2026-05-22", "2026-04-03", "2026-02-13"].map((start, i) =>
      trip(
        `dj${i}`,
        "대전 여행",
        start,
        start.replace(/\d\d$/, (d) => String(Number(d) + 2).padStart(2, "0")),
        {
          anchorPlaceName: "본가",
        }
      )
    );
    const hk = trip("hk", "홍콩 여행", "2026-03-26", "2026-03-30", {
      isOverseas: true,
      totalDistanceMeters: 5_290_000,
      visitCount: 151,
      visitedCities: ["Kowloon"],
    });
    const jeju = trip("jeju", "제주 여행", "2026-07-16", "2026-07-18", { totalSpending: 706_180 });
    const old = trip("old", "경북 여행", "2026-01-21", "2026-01-25");
    const trips = [dj[0], jeju, dj[1], dj[2], hk, dj[3], old];
    const markup = render({
      trips,
      summary: { year: 2026, trips, spendingSince: "2026-03-03" },
      hasMore: true,
    });

    expect(markup).toContain("2026년 · 11월 10일까지");
    expect(markup).toContain("올해 눈에 띈 여행");
    expect(markup).toContain("해외 · 가장 먼 여행");
    expect(markup).toContain("대전 · 본가");
    expect(markup).toContain("회 반복");
    expect(markup).toContain("기록 없음");
    expect(markup).toContain("2026년 1월 이전 여행 더 보기");
    expect(markup).toMatch(/aria-label="[^"]+ 여행 메뉴"/);
    // The recurring group's trips render once (inside the group), not again under the year.
    expect(markup.match(/href="\/travel\/dj0"/g)).toHaveLength(1);
  });
});
