import { describe, expect, it } from "vitest";
import { isMonoFactValue } from "./fact-text";

describe("isMonoFactValue", () => {
  it("keeps numbers with glued units in mono", () => {
    expect(isMonoFactValue("11월 9일 · 59bpm")).toBe(true);
    expect(isMonoFactValue("72분")).toBe(true);
    expect(isMonoFactValue("4시간 59분")).toBe(true);
    expect(isMonoFactValue("의료·건강 1,680,000원 / 전체 3,040,140원")).toBe(false);
    expect(isMonoFactValue("1,680,000원 / 3,040,140원")).toBe(true);
    expect(isMonoFactValue("2.32 GB")).toBe(true);
    expect(isMonoFactValue("9월 6일 (일) 17:00 · 64일 전")).toBe(true);
    expect(isMonoFactValue("90.5kg · 9월 6일 (9주 전)")).toBe(true);
  });

  it("sets values with free Korean words in sans", () => {
    expect(isMonoFactValue("커밋 요약 테이블 0행")).toBe(false);
    expect(isMonoFactValue("제공자가 인증을 거부함 · 다시 연결 필요")).toBe(false);
    expect(isMonoFactValue("Fitbit 수면 단계 · 최근 10밤")).toBe(false);
  });
});
