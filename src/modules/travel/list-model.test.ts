import { describe, expect, it } from "vitest";
import type { TravelListSummary, TravelTripListItem } from "./hooks";
import {
  byYear,
  destinationOf,
  formatKm,
  groupLabel,
  groupRecurring,
  isSpendingRecorded,
  pickHighlights,
  rangeLabel,
  rangeWithWeekdays,
  ribbonSpans,
  stayLabel,
  summarizeYear,
  yearRecurringFact,
} from "./list-model";

let seq = 0;
function trip(
  name: string,
  startDate: string,
  endDate: string,
  extra: Partial<TravelTripListItem> = {}
): TravelTripListItem {
  seq += 1;
  return {
    id: `t${seq}`,
    userId: "u",
    name,
    startDate,
    endDate,
    totalDistanceMeters: 300_000,
    visitedCities: [],
    visitedCountries: [],
    isOverseas: false,
    autoDetected: true,
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    totalSpending: 100_000,
    visitCount: 20,
    anchorPlaceName: null,
    ...extra,
  };
}

describe("formatting helpers", () => {
  it("labels stays, ranges and destinations", () => {
    expect(stayLabel("2026-09-23", "2026-09-25")).toBe("2박 3일");
    expect(stayLabel("2026-09-23", "2026-09-23")).toBe("당일");
    expect(rangeLabel("2025-11-12", "2025-11-15")).toBe("11월 12일–15일");
    expect(rangeWithWeekdays("2026-03-26", "2026-03-30")).toBe("3월 26일 (목)–30일 (월)");
    expect(destinationOf({ name: "대전 여행" })).toBe("대전");
    expect(destinationOf({ name: "여름 휴가" })).toBe("여름 휴가");
    expect(formatKm(null)).toBe("–");
    expect(formatKm(298)).toBe("0.3 km");
    expect(formatKm(3_338_000)).toBe("3,338 km");
  });

  it("treats trips that ended before the first Toss record as unrecorded, not 0원", () => {
    expect(isSpendingRecorded({ endDate: "2026-02-18" }, "2026-03-03")).toBe(false);
    expect(isSpendingRecorded({ endDate: "2026-03-03" }, "2026-03-03")).toBe(true);
    expect(isSpendingRecorded({ endDate: "2026-09-01" }, null)).toBe(false);
  });
});

describe("groupRecurring", () => {
  it("collapses a destination visited four times and names its shared saved place", () => {
    const list = [
      trip("대전 여행", "2026-09-23", "2026-09-25", { anchorPlaceName: "본가" }),
      trip("대구 여행", "2026-09-05", "2026-09-06"),
      trip("대전 여행", "2026-05-22", "2026-05-24", { anchorPlaceName: "본가" }),
      trip("대구 여행", "2026-08-08", "2026-08-09"),
      trip("대전 여행", "2026-04-03", "2026-04-05", { anchorPlaceName: "본가" }),
      trip("대구 여행", "2026-08-14", "2026-08-17"),
      trip("대전 여행", "2026-02-13", "2026-02-18", { totalSpending: 0 }),
    ];
    const { groups, rest } = groupRecurring(list, "2026-03-03");

    expect(groups).toHaveLength(1);
    expect(groupLabel(groups[0])).toBe("대전 · 본가");
    expect(groups[0].trips.map((t) => t.startDate)).toEqual([
      "2026-09-23",
      "2026-05-22",
      "2026-04-03",
      "2026-02-13",
    ]);
    expect(groups[0].firstStart).toBe("2026-02-13");
    expect(groups[0].lastEnd).toBe("2026-09-25");
    expect(groups[0].totalDays).toBe(3 + 3 + 3 + 6);
    expect(groups[0].spendRecordedCount).toBe(3);
    expect(rest.map((t) => t.name)).toEqual(["대구 여행", "대구 여행", "대구 여행"]);
  });

  it("groups three trips only when they share a saved place, and never overseas trips", () => {
    const anchored = [1, 2, 3].map((i) =>
      trip("부산 여행", `2026-0${i}-01`, `2026-0${i}-02`, { anchorPlaceName: "외가" })
    );
    const abroad = [1, 2, 3, 4].map((i) =>
      trip("일본 여행", `2025-0${i}-01`, `2025-0${i}-03`, { isOverseas: true })
    );
    const { groups } = groupRecurring([...anchored, ...abroad], null);
    expect(groups.map((g) => g.destination)).toEqual(["부산"]);
  });

  it("splits the rest by start year, newest first", () => {
    const years = byYear([
      trip("a", "2026-01-01", "2026-01-02"),
      trip("b", "2025-12-30", "2026-01-01"),
    ]);
    expect(years.map((y) => y.year)).toEqual([2026, 2025]);
  });
});

function summaryOf(trips: TravelTripListItem[], spendingSince: string | null = "2026-03-03") {
  return { year: 2026, trips, spendingSince } satisfies TravelListSummary;
}

describe("year summary", () => {
  it("counts trips, days up to today, overseas destinations and recorded spending", () => {
    const s = summaryOf([
      trip("경북 여행", "2026-01-21", "2026-01-25", { totalSpending: 0 }),
      trip("홍콩 여행", "2026-03-26", "2026-03-30", { isOverseas: true, totalSpending: 62_150 }),
      trip("제주 여행", "2026-07-16", "2026-07-18", { totalSpending: 706_180 }),
      trip("연말 여행", "2026-12-30", "2027-01-02"),
    ]);
    const y = summarizeYear(s, "2026-11-10");
    expect(y.tripCount).toBe(4);
    expect(y.days).toBe(5 + 5 + 3);
    expect(y.elapsedDays).toBe(314);
    expect(y.overseas).toEqual(["홍콩"]);
    expect(y.spendTotal).toBe(62_150 + 706_180 + 100_000);
    expect(y.spendRecordedCount).toBe(3);
    expect(y.spendMissingCount).toBe(1);
  });

  it("explains a destination that took a large share of the year, with departure weekdays", () => {
    const dj = [
      trip("대전 여행", "2026-09-25", "2026-09-27", { anchorPlaceName: "본가" }),
      trip("대전 여행", "2026-05-22", "2026-05-24", { anchorPlaceName: "본가" }),
      trip("대전 여행", "2026-04-03", "2026-04-05", { anchorPlaceName: "본가" }),
      trip("대전 여행", "2026-02-13", "2026-02-18", { anchorPlaceName: "본가" }),
    ];
    const others = [
      trip("제주 여행", "2026-07-16", "2026-07-18"),
      trip("대구 여행", "2026-08-08", "2026-08-09"),
    ];
    const s = summaryOf([...dj, ...others]);
    const { groups } = groupRecurring([...dj, ...others], s.spendingSince);
    const fact = yearRecurringFact(s, groups, "2026-11-10");

    expect(fact?.trigger).toBe("4번");
    expect(`${fact?.pre}${fact?.trigger}${fact?.post}`).toBe(
      "6번 중 4번(15일)이 대전 본가였어요 — 빼면 2번, 5일. 본가행 4번 중 4번은 금요일에 출발했어요."
    );
    expect(fact?.evidence).toEqual({ kind: "keys", keys: dj.map((t) => t.id) });
  });

  it("says nothing when no destination recurs", () => {
    const s = summaryOf([trip("a", "2026-01-01", "2026-01-02")]);
    expect(yearRecurringFact(s, [], "2026-11-10")).toBeNull();
  });
});

describe("ribbon and highlights", () => {
  it("places spans as fractions of the year", () => {
    const [span] = ribbonSpans(summaryOf([trip("a", "2026-01-01", "2026-01-01")]));
    expect(span.from).toBe(0);
    expect(span.to).toBeCloseTo(1 / 365);
  });

  it("picks the farthest and the biggest-spending trip with one computed line each", () => {
    const hk = trip("홍콩 여행", "2026-03-26", "2026-03-30", {
      isOverseas: true,
      totalDistanceMeters: 5_290_000,
      visitCount: 151,
      totalSpending: 62_150,
    });
    const jeju = trip("제주 여행", "2026-07-16", "2026-07-18", {
      totalDistanceMeters: 1_273_000,
      visitCount: 37,
      totalSpending: 706_180,
    });
    const daegu = trip("대구 여행", "2026-09-05", "2026-09-06", {
      totalDistanceMeters: 324_000,
      visitCount: 25,
      totalSpending: 309_560,
    });
    const old = trip("경북 여행", "2026-01-21", "2026-01-25", { totalSpending: 0 });
    const highlights = pickHighlights(summaryOf([old, hk, jeju, daegu]));

    expect(highlights.map((h) => [h.trip.name, h.tag])).toEqual([
      ["홍콩 여행", "해외 · 가장 먼 여행"],
      ["제주 여행", "올해 가장 많이 쓴 여행"],
    ]);
    expect(highlights[0].fact?.trigger).toBe("74%");
    expect(highlights[1].fact?.trigger).toBe("235,393원");
    expect(highlights[1].fact?.post).toContain(
      "지출 기록이 있는 3개 여행 중 하루 지출이 가장 컸고"
    );
  });
});
