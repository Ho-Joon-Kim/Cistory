import { describe, expect, it } from "vitest";
import { parseNaturalQuery } from "./nl-parser";

const TODAY = "2026-11-09"; // 월요일

describe("parseNaturalQuery", () => {
  it("reads a relative month with filler words and leaves no term", () => {
    expect(parseNaturalQuery("최근 한 달 동안 남긴 기록", TODAY)).toEqual({
      q: "",
      range: { from: "2026-10-11", to: "2026-11-09", label: "최근 30일" },
      sources: [],
      category: null,
      hours: null,
    });
  });

  it("splits several sources joined by particles", () => {
    const parsed = parseNaturalQuery("오늘 쓴 돈이랑 간 곳", TODAY);
    expect(parsed.range).toEqual({ from: TODAY, to: TODAY, label: "오늘" });
    expect(parsed.sources).toEqual(["spending", "visit"]);
    expect(parsed.q).toBe("");
  });

  it("maps categories (implying spending) and time of day", () => {
    const parsed = parseNaturalQuery("지난주 저녁 배달", TODAY);
    expect(parsed.range).toEqual({ from: "2026-11-02", to: "2026-11-08", label: "지난주" });
    expect(parsed.category).toBe("food");
    expect(parsed.sources).toEqual(["spending"]);
    expect(parsed.hours).toMatchObject({ from: 18, to: 22 });
    expect(parsed.q).toBe("");
  });

  it("keeps the remaining words as the literal term", () => {
    const parsed = parseNaturalQuery("10월 성수동 카페", TODAY);
    expect(parsed.range).toEqual({ from: "2026-10-01", to: "2026-10-31", label: "10월" });
    expect(parsed.category).toBe("cafe");
    expect(parsed.q).toBe("성수동");
  });

  it("puts a future month in the previous year and specific days before counts", () => {
    expect(parseNaturalQuery("12월 여행", TODAY)).toMatchObject({
      range: { from: "2025-12-01", to: "2025-12-31" },
      sources: ["trip"],
    });
    expect(parseNaturalQuery("10월 17일 커밋", TODAY).range).toEqual({
      from: "2026-10-17",
      to: "2026-10-17",
      label: "10월 17일",
    });
    expect(parseNaturalQuery("17일 회의", TODAY).range).toBeNull();
  });

  it("wraps late-night windows and caps long counts at 366 days", () => {
    expect(parseNaturalQuery("새벽 커밋", TODAY).hours).toMatchObject({ from: 0, to: 6 });
    expect(parseNaturalQuery("심야 택시", TODAY)).toMatchObject({
      hours: { from: 22, to: 4 },
      category: "transport",
    });
    expect(parseNaturalQuery("최근 24개월", TODAY).range?.from).toBe("2025-11-09");
  });

  it("returns plain text untouched when nothing is recognised", () => {
    expect(parseNaturalQuery("fix(api) RE-1008", TODAY)).toEqual({
      q: "fix(api) RE-1008",
      range: null,
      sources: [],
      category: null,
      hours: null,
    });
  });
});
