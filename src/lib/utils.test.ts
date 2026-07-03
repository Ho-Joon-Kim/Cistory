// TZ is pinned so these tests exercise the exact production condition
// (containers run with TZ=Asia/Seoul, UTC+9). Must be set before any Date use.
process.env.TZ = "Asia/Seoul";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  endOfLocalDay,
  parseDateLocal,
  parseDateParam,
  startOfLocalDay,
  toLocalDateString,
} from "./utils";

afterEach(() => {
  vi.useRealTimers();
});

// 2026-03-04T23:30:00Z == 2026-03-05 08:30 KST. Every date-only value in this
// app means a KST calendar day, so "today" must be 03-05, not the UTC 03-04.
function freezeAtKstMorning() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-04T23:30:00Z"));
}

describe("parseDateParam", () => {
  it("resolves 'today' as the local (KST) day, not the UTC day", () => {
    freezeAtKstMorning();
    expect(parseDateParam(null)).toBe("2026-03-05");
  });

  it("does not reject today's local date as 'future' during the 00:00-09:00 KST window", () => {
    freezeAtKstMorning();
    // Buggy UTC-today ("2026-03-04") would clamp this valid request back a day.
    expect(parseDateParam("2026-03-05")).toBe("2026-03-05");
  });

  it("passes through a valid past date", () => {
    freezeAtKstMorning();
    expect(parseDateParam("2026-01-15")).toBe("2026-01-15");
  });

  it("expands MM-DD and MMDD using the current local year", () => {
    freezeAtKstMorning();
    expect(parseDateParam("01-15")).toBe("2026-01-15");
    expect(parseDateParam("0115")).toBe("2026-01-15");
  });

  it("falls back to today for invalid calendar dates", () => {
    freezeAtKstMorning();
    expect(parseDateParam("2026-02-30")).toBe("2026-03-05");
    expect(parseDateParam("nonsense")).toBe("2026-03-05");
  });

  it("clamps future dates to today", () => {
    freezeAtKstMorning();
    expect(parseDateParam("2027-01-01")).toBe("2026-03-05");
  });
});

describe("parseDateLocal", () => {
  it("parses YYYY-MM-DD as local midnight, not UTC midnight", () => {
    const d = parseDateLocal("2026-03-04");
    expect(d).not.toBeNull();
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(2);
    expect(d?.getDate()).toBe(4);
    expect(d?.getHours()).toBe(0);
  });

  it("passes full ISO strings through to Date parsing", () => {
    const d = parseDateLocal("2026-03-04T12:00:00Z");
    expect(d?.getTime()).toBe(new Date("2026-03-04T12:00:00Z").getTime());
  });

  it("returns null for invalid input", () => {
    expect(parseDateLocal("not-a-date")).toBeNull();
  });
});

describe("toLocalDateString", () => {
  it("formats using local calendar fields", () => {
    expect(toLocalDateString(new Date(2026, 2, 4, 0, 30))).toBe("2026-03-04");
  });

  it("round-trips a UTC instant that falls on the previous UTC day", () => {
    // 2026-03-04 08:30 KST == 2026-03-03T23:30Z; toISOString would say 03-03.
    expect(toLocalDateString(new Date("2026-03-03T23:30:00Z"))).toBe("2026-03-04");
  });

  it("round-trips with parseDateLocal", () => {
    expect(toLocalDateString(parseDateLocal("2026-12-31") as Date)).toBe("2026-12-31");
  });
});

describe("startOfLocalDay / endOfLocalDay", () => {
  it("spans exactly the local calendar day", () => {
    const start = startOfLocalDay("2026-03-04");
    const end = endOfLocalDay("2026-03-04");
    expect(toLocalDateString(start)).toBe("2026-03-04");
    expect(toLocalDateString(end)).toBe("2026-03-04");
    expect(end.getTime() - start.getTime()).toBe(86_400_000 - 1);
  });
});
