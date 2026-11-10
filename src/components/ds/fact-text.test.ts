import { describe, expect, it } from "vitest";
import { factValueParts, isMonoFactValue } from "./fact-text";

describe("isMonoFactValue", () => {
  it("sets pure quantities (number + unit) in mono", () => {
    expect(isMonoFactValue("72분")).toBe(true);
    expect(isMonoFactValue("4시간 59분")).toBe(true);
    expect(isMonoFactValue("1,680,000원 / 3,040,140원")).toBe(true);
    expect(isMonoFactValue("2.32 GB")).toBe(true);
    expect(isMonoFactValue("+835 −185")).toBe(true);
  });

  it("gives same-shape QA rows one face (qa4-qa-b N2)", () => {
    // Spending 851,670원: both count+amount rows are quantities ("10일" = ten days in).
    expect(isMonoFactValue("1건 1,800,000원")).toBe(true);
    expect(isMonoFactValue("17건 283,890원 · 10일")).toBe(true);
    // Spending 111,680원: a pure quantity vs a row that carries a date range.
    expect(isMonoFactValue("129,380원 · 8건")).toBe(true);
    expect(isMonoFactValue("5건 111,680원 · 11월 5일–9일")).toBe(false);
    // Health: bare durations are mono, the same value pinned to a night is sans.
    expect(isMonoFactValue("53분")).toBe(true);
    expect(isMonoFactValue("4회 · 53분")).toBe(true);
    expect(isMonoFactValue("72분")).toBe(true);
    expect(isMonoFactValue("59bpm")).toBe(true);
    expect(isMonoFactValue("11월 9일 밤 · 72분")).toBe(false);
    expect(isMonoFactValue("11월 9일 · 59bpm")).toBe(false);
    expect(isMonoFactValue("하루 283,890원 × 31일")).toBe(false);
    expect(isMonoFactValue("52–65bpm · 중앙값 59")).toBe(false);
  });

  it("treats durations as quantities but months and relative days as words", () => {
    expect(isMonoFactValue("3개월")).toBe(true);
    expect(isMonoFactValue("10월")).toBe(false);
    expect(isMonoFactValue("64일 전")).toBe(false);
    expect(isMonoFactValue("3 짧음")).toBe(false);
    expect(isMonoFactValue("Fitbit 3")).toBe(false);
  });

  it("sets dates and times in sans, so same-shape rows agree", () => {
    expect(isMonoFactValue("11월 9일 · 59bpm")).toBe(false);
    expect(isMonoFactValue("10월 29일 · 65bpm (30일 최고와 같음)")).toBe(false);
    expect(isMonoFactValue("9월 6일 (일) 17:00 · 64일 전")).toBe(false);
    expect(isMonoFactValue("90.5kg · 9월 6일 (9주 전)")).toBe(false);
    expect(isMonoFactValue("11월 9일 08:45, 11월 6일 16:51")).toBe(false);
    expect(isMonoFactValue("5건 111,680원 · 11월 5일–9일")).toBe(false);
  });

  it("sets values with free Korean words in sans", () => {
    expect(isMonoFactValue("의료·건강 1,680,000원 / 전체 3,040,140원")).toBe(false);
    expect(isMonoFactValue("커밋 요약 테이블 0행")).toBe(false);
    expect(isMonoFactValue("제공자가 인증을 거부함 · 다시 연결 필요")).toBe(false);
    expect(isMonoFactValue("Fitbit 수면 단계 · 최근 10밤")).toBe(false);
  });
});

describe("isMonoFactValue — number phrases (qa6)", () => {
  it("treats a number glued to a relational word as a phrase, not a quantity", () => {
    for (const phrase of [
      "10분마다",
      "3일째",
      "8시간째",
      "5시부터",
      "7일까지",
      "2시간전",
      "1시간후",
      "2건씩",
      "3일 동안",
      "10분 만에",
      "30분쯤",
      "5건 이상",
      "1시간 미만",
      "10분 넘게",
    ]) {
      expect(isMonoFactValue(phrase), phrase).toBe(false);
    }
  });

  it("keeps plain quantities whose unit merely ends in a similar syllable", () => {
    expect(isMonoFactValue("4시간")).toBe(true);
    expect(isMonoFactValue("3,000원")).toBe(true);
    expect(isMonoFactValue("12건 · 4시간 59분")).toBe(true);
  });
});

describe("factValueParts", () => {
  it("keeps each short list entry whole, separator at the end of the line", () => {
    expect(factValueParts("11월 9일 08:45, 11월 6일 16:51, 11월 5일 08:58")).toEqual([
      { text: "11월 9일 08:45,", keep: true },
      { text: "11월 6일 16:51,", keep: true },
      { text: "11월 5일 08:58", keep: true },
    ]);
    expect(factValueParts("9월 6일 (일) 17:00 · 64일 전")).toEqual([
      { text: "9월 6일 (일) 17:00 ·", keep: true },
      { text: "64일 전", keep: true },
    ]);
  });

  it("lets long or wordy entries wrap", () => {
    expect(factValueParts("제공자가 인증을 거부함 · 다시 연결 필요")).toEqual([
      { text: "제공자가 인증을 거부함 ·", keep: false },
      { text: "다시 연결 필요", keep: false },
    ]);
    expect(factValueParts("의료·건강 1건")).toEqual([{ text: "의료·건강 1건", keep: true }]);
  });
});
