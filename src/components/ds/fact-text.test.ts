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

  it("sets dates and times in sans, so same-shape rows agree", () => {
    expect(isMonoFactValue("11월 9일 · 59bpm")).toBe(false);
    expect(isMonoFactValue("10월 29일 · 65bpm (30일 최고와 같음)")).toBe(false);
    expect(isMonoFactValue("9월 6일 (일) 17:00 · 64일 전")).toBe(false);
    expect(isMonoFactValue("90.5kg · 9월 6일 (9주 전)")).toBe(false);
    expect(isMonoFactValue("11월 9일 08:45, 11월 6일 16:51")).toBe(false);
    expect(isMonoFactValue("17건 283,890원 · 10일")).toBe(false);
    expect(isMonoFactValue("5건 111,680원 · 11월 5일–9일")).toBe(false);
  });

  it("sets values with free Korean words in sans", () => {
    expect(isMonoFactValue("의료·건강 1,680,000원 / 전체 3,040,140원")).toBe(false);
    expect(isMonoFactValue("커밋 요약 테이블 0행")).toBe(false);
    expect(isMonoFactValue("제공자가 인증을 거부함 · 다시 연결 필요")).toBe(false);
    expect(isMonoFactValue("Fitbit 수면 단계 · 최근 10밤")).toBe(false);
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
