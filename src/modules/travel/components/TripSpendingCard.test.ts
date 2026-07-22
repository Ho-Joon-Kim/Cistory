import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TravelTripDetail } from "../hooks";
import { TripSpendingCard } from "./TripSpendingCard";

type Spending = TravelTripDetail["spending"];

function render(spending: Spending): string {
  return renderToStaticMarkup(createElement(TripSpendingCard, { spending }));
}

describe("TripSpendingCard", () => {
  it("지출이 없어도 총비용과 일 평균을 0원으로 표시한다", () => {
    const markup = render({ total: 0, dailyAverage: 0, categories: [], transactions: [] });

    expect(markup).toContain("총비용");
    expect(markup).toContain("0원");
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("Infinity");
  });

  it("카테고리를 큰 금액순으로 표시하고 null 거래를 미분류로 안전하게 접어 둔다", () => {
    const markup = render({
      total: 45_000,
      dailyAverage: 15_000,
      categories: [
        { category: "food", total: 15_000, count: 1 },
        { category: "transport", total: 30_000, count: 1 },
      ],
      transactions: [
        {
          id: "tx-1",
          amount: 15_000,
          merchant: "현장 결제",
          accountName: "카드",
          category: null,
          transactedAt: "2026-07-15T23:30:00.000Z",
        },
      ],
    });

    expect(markup.indexOf("교통")).toBeLessThan(markup.indexOf("식비"));
    expect(markup).toContain("미분류");
    expect(markup).toContain("08:30");
    expect(markup).toContain("<details");
  });
});
