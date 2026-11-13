import { describe, expect, it } from "vitest";
import { McpInputError } from "./errors";
import {
  isDateKey,
  kstDayStart,
  parseBoundary,
  parseInstant,
  parseTimeRange,
  toKstIso,
  toKstIsoOrNull,
} from "./time";

describe("parseInstant", () => {
  it("reads Z as UTC: 09:00Z is 18:00 KST", () => {
    const date = parseInstant("2026-11-13T09:00:00Z");
    expect(date.toISOString()).toBe("2026-11-13T09:00:00.000Z");
    expect(toKstIso(date)).toBe("2026-11-13T18:00:00+09:00");
  });

  it("honors explicit offsets, fractions and minute precision", () => {
    expect(parseInstant("2026-11-13T18:00:00+09:00").toISOString()).toBe(
      "2026-11-13T09:00:00.000Z"
    );
    expect(parseInstant("2026-11-13T04:00-05:00").toISOString()).toBe("2026-11-13T09:00:00.000Z");
    expect(parseInstant("2026-11-13T09:00:00.123Z").toISOString()).toBe("2026-11-13T09:00:00.123Z");
  });

  it.each(["2026-11-13T09:00:00", "2026-11-13T09:00", "2026-11-13 09:00:00"])(
    "rejects offsetless %s",
    (value) => {
      expect(() => parseInstant(value)).toThrow(McpInputError);
      try {
        parseInstant(value);
      } catch (error) {
        expect((error as McpInputError).code).toBe("time_offset_required");
      }
    }
  );

  it.each([
    "",
    "yesterday",
    "2026-02-30T00:00:00Z",
    "2026-11-13T25:00:00Z",
    "2026-11-13T09:00:00+15:00",
  ])("rejects invalid %j", (value) => {
    expect(() => parseInstant(value)).toThrow(McpInputError);
  });
});

describe("date keys", () => {
  it("validates calendar dates", () => {
    expect(isDateKey("2026-11-13")).toBe(true);
    expect(isDateKey("2026-02-29")).toBe(false);
    expect(isDateKey("2026-11-13T00:00:00Z")).toBe(false);
  });

  it("2026-11-13 is the whole KST day", () => {
    expect(kstDayStart("2026-11-13").toISOString()).toBe("2026-11-12T15:00:00.000Z");
    expect(parseBoundary("2026-11-13", "start").toISOString()).toBe("2026-11-12T15:00:00.000Z");
    expect(parseBoundary("2026-11-13", "end").toISOString()).toBe("2026-11-13T15:00:00.000Z");
  });

  it("rejects a malformed date-only boundary", () => {
    expect(() => parseBoundary("2026-13-01", "start")).toThrow(McpInputError);
  });
});

describe("parseTimeRange", () => {
  const now = new Date("2026-11-13T01:00:00Z"); // 10:00 KST

  it("a single date covers exactly that KST day", () => {
    const range = parseTimeRange({ from: "2026-11-13", to: "2026-11-13" });
    expect(range.start.toISOString()).toBe("2026-11-12T15:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-11-13T15:00:00.000Z");
    expect(range).toMatchObject({ fromDate: "2026-11-13", toDate: "2026-11-13" });
  });

  it("defaults to the last N KST days ending today", () => {
    const range = parseTimeRange({}, { now, defaultDays: 7 });
    expect(range).toMatchObject({ fromDate: "2026-11-07", toDate: "2026-11-13" });
  });

  it("accepts exactly 366 days and rejects 367", () => {
    expect(parseTimeRange({ from: "2025-11-13", to: "2026-11-13" }).toDate).toBe("2026-11-13");
    expect(() => parseTimeRange({ from: "2025-11-12", to: "2026-11-13" })).toThrow(/최대 366일/);
  });

  it("caps instant ranges by duration too", () => {
    expect(() =>
      parseTimeRange({ from: "2025-01-01T00:00:00Z", to: "2026-01-02T00:00:01Z" })
    ).toThrow(McpInputError);
  });

  it("rejects inverted and empty ranges", () => {
    expect(() => parseTimeRange({ from: "2026-11-14", to: "2026-11-13" })).toThrow(McpInputError);
    expect(() =>
      parseTimeRange({ from: "2026-11-13T09:00:00Z", to: "2026-11-13T09:00:00Z" })
    ).toThrow(McpInputError);
  });

  it("rejects an offsetless bound", () => {
    expect(() => parseTimeRange({ from: "2026-11-13T09:00:00" })).toThrow(/오프셋/);
  });
});

describe("toKstIso", () => {
  it("renders +09:00 and crosses the KST date line", () => {
    expect(toKstIso(new Date("2026-11-12T15:30:05.900Z"))).toBe("2026-11-13T00:30:05+09:00");
    expect(toKstIsoOrNull(null)).toBeNull();
  });
});
