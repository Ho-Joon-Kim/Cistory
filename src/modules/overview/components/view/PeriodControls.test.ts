import { describe, expect, it } from "vitest";
import { switchPeriodType } from "./PeriodControls";

// 2026-11-10 12:00 KST
const NOW = new Date("2026-11-10T03:00:00Z");

describe("switchPeriodType", () => {
  it("keeps the context of an ended period", () => {
    expect(switchPeriodType({ periodType: "month", periodKey: "2026-10" }, "week", NOW)).toBe(
      "2026-W44"
    );
    expect(switchPeriodType({ periodType: "week", periodKey: "2026-W40" }, "month", NOW)).toBe(
      "2026-10"
    );
  });

  it("lands on the current period while the shown one is in progress", () => {
    expect(switchPeriodType({ periodType: "month", periodKey: "2026-11" }, "week", NOW)).toBe(
      "2026-W46"
    );
    expect(switchPeriodType({ periodType: "year", periodKey: "2026" }, "month", NOW)).toBe(
      "2026-11"
    );
  });
});
