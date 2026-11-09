import { describe, expect, it } from "vitest";
import {
  formatCount,
  formatDateRange,
  formatDateTime,
  formatDay,
  formatDeltaPercent,
  formatDurationMinutes,
  formatMonthDay,
  formatRelative,
  formatReturn,
  formatShare,
  formatTime,
  formatWon,
  formatWonCompact,
  MINUS,
  signTone,
  signToneClass,
  splitWonCompact,
} from "./format";

// 2026-11-09 22:11 KST
const NOW = new Date("2026-11-09T13:11:00Z");

describe("money", () => {
  it("formats full amounts with 원 and grouping", () => {
    expect(formatWon(2_083_890)).toBe("2,083,890원");
    expect(formatWon(0)).toBe("0원");
    expect(formatWon(-16_400)).toBe(`${MINUS}16,400원`);
  });

  it("writes an explicit sign for cash flow when asked", () => {
    expect(formatWon(30_000, { sign: true })).toBe("+30,000원");
    expect(formatWon(-16_400, { sign: true })).toBe(`${MINUS}16,400원`);
    expect(formatWon(0, { sign: true })).toBe("0원");
  });

  it("compacts from 1만 with one decimal of 만원", () => {
    expect(formatWonCompact(5_417_390)).toBe("541.7만원");
    expect(formatWonCompact(52_344_071)).toBe("5,234.4만원");
    expect(formatWonCompact(300_000)).toBe("30만원");
    expect(formatWonCompact(9_280)).toBe("9,280원");
    expect(formatWonCompact(10_000)).toBe("1만원");
    expect(formatWonCompact(-1_800_000, { sign: true })).toBe(`${MINUS}180만원`);
  });

  it("splits compact amounts for hero rendering", () => {
    expect(splitWonCompact(5_417_390)).toEqual({ value: "541.7", unit: "만원" });
    expect(splitWonCompact(9_280)).toEqual({ value: "9,280", unit: "원" });
  });
});

describe("numbers and ratios", () => {
  it("groups counts", () => {
    expect(formatCount(4673)).toBe("4,673");
    expect(formatCount(12.6)).toBe("13");
    expect(formatCount(-3, { sign: true })).toBe(`${MINUS}3`);
  });

  it("rounds shares to integers and keeps two decimals for returns", () => {
    expect(formatShare(0.4196)).toBe("42%");
    expect(formatReturn(-0.0267)).toBe(`${MINUS}2.67%`);
    expect(formatReturn(0.1)).toBe("+10.00%");
    expect(formatDeltaPercent(0.058)).toBe("+6%");
    expect(formatDeltaPercent(-0.2)).toBe(`${MINUS}20%`);
  });
});

describe("sign colors", () => {
  it("uses red/blue only in the market domain", () => {
    expect(signTone(1_449_000, "market")).toBe("gain");
    expect(signTone(-0.0267, "market")).toBe("loss");
    expect(signTone(0, "market")).toBe("ink");
    expect(signTone(7_049_811, "cash")).toBe("ink");
    expect(signTone(-16_400, "cash")).toBe("ink");
    expect(signToneClass(-1, "market")).toBe("text-loss");
    expect(signToneClass(1, "cash")).toBe("text-ink");
  });
});

describe("dates", () => {
  it("formats a KST day with weekday and omits the current year", () => {
    expect(formatDay("2026-11-09", { now: NOW })).toBe("11월 9일 (월)");
    expect(formatDay("2025-03-09", { now: NOW })).toBe("2025년 3월 9일 (일)");
    expect(formatMonthDay("2026-10-21", { now: NOW })).toBe("10월 21일");
  });

  it("reads a Date as its KST calendar day", () => {
    // 2026-11-08 16:30 UTC is already 11월 9일 in Seoul.
    expect(formatDay(new Date("2026-11-08T16:30:00Z"), { now: NOW })).toBe("11월 9일 (월)");
  });

  it("formats ranges", () => {
    expect(formatDateRange("2026-10-11", "2026-11-09", { now: NOW })).toBe("10월 11일–11월 9일");
    expect(formatDateRange("2026-10-01", "2026-10-31", { now: NOW })).toBe("10월 1일–31일");
    expect(formatDateRange("2026-10-21", "2026-10-21", { now: NOW })).toBe("10월 21일");
    expect(formatDateRange("2025-03-01", "2025-03-09", { now: NOW })).toBe("2025년 3월 1일–9일");
    expect(formatDateRange("2025-12-30", "2026-01-02", { now: NOW })).toBe(
      "2025년 12월 30일–2026년 1월 2일"
    );
  });

  it("formats KST clock times in 24h", () => {
    expect(formatTime(new Date("2026-11-09T12:28:11Z"))).toBe("21:28");
    expect(formatTime(new Date("2026-11-08T15:05:00Z"))).toBe("00:05");
    expect(formatDateTime(new Date("2026-09-06T08:00:00Z"), { now: NOW })).toBe(
      "9월 6일 (일) 17:00"
    );
  });

  it("formats recency", () => {
    expect(formatRelative(new Date(NOW.getTime() - 20_000), NOW)).toBe("방금");
    expect(formatRelative(new Date(NOW.getTime() + 60_000), NOW)).toBe("방금");
    expect(formatRelative(new Date(NOW.getTime() - 35 * 60_000), NOW)).toBe("35분 전");
    expect(formatRelative(new Date(NOW.getTime() - 7 * 3_600_000), NOW)).toBe("7시간 전");
    expect(formatRelative("2026-09-06T08:00:00Z", NOW)).toBe("64일 전");
  });

  it("rejects malformed date keys", () => {
    expect(() => formatDay("11.9")).toThrow();
  });
});

describe("durations", () => {
  it("uses hours and minutes", () => {
    expect(formatDurationMinutes(114)).toBe("1시간 54분");
    expect(formatDurationMinutes(45)).toBe("45분");
    expect(formatDurationMinutes(374 * 60 + 12)).toBe("374시간");
    expect(formatDurationMinutes(120)).toBe("2시간");
  });
});
