import { describe, expect, it } from "vitest";
import { type FlowUnit, stayAnnotation } from "./flow";

const unit = (day: number, commits: number): FlowUnit => ({
  key: `2026-10-${String(day).padStart(2, "0")}`,
  label: String(day),
  showLabel: true,
  title: `10월 ${day}일`,
  commits,
  steps: null,
  spending: null,
  income: null,
  future: false,
  partial: false,
  weekend: false,
});

const units = Array.from({ length: 31 }, (_, i) => unit(i + 1, 10));
const focus = {
  area: "대전",
  place: "60계치킨 대전유성점",
  commits: 531,
  from: "2026-10-01",
  to: "2026-10-31",
};

describe("stayAnnotation", () => {
  it("spans the longest run of visit days, bridging short gaps", () => {
    const a = stayAnnotation(units, focus, [
      "2026-10-02",
      "2026-10-10",
      "2026-10-12",
      "2026-10-15",
      "2026-10-16",
      "2026-10-25",
    ]);
    expect(a).toMatchObject({ from: 9, to: 15, lane: 1 });
    expect(a?.label).toBe("대전 체류 · 60계치킨 대전유성점에서 531커밋");
    expect(a?.rows.at(-1)).toEqual({ label: "그동안 전체 커밋", value: "70" });
  });

  it("needs at least two days", () => {
    expect(stayAnnotation(units, focus, ["2026-10-02"])).toBeNull();
    expect(stayAnnotation(units, focus, [])).toBeNull();
  });
});
