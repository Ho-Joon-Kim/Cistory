import { describe, expect, it } from "vitest";
import { formatDuration, formatFallbackLabel, formatTransportMode } from "./format";

describe("overview card formatters", () => {
  it.each([
    [3_599, "1시간"],
    [7_199, "2시간"],
  ])("normalizes %i seconds without rendering 60 minutes", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
    expect(formatDuration(seconds)).not.toContain("60분");
  });

  it("translates known transport modes and the unknown fallback", () => {
    expect(formatTransportMode("walking")).toBe("도보");
    expect(formatTransportMode("transit")).toBe("대중교통");
    expect(formatTransportMode("unknown")).toBe("알 수 없음");
    expect(formatTransportMode("flying")).toBe("항공");
    expect(formatFallbackLabel("Unknown")).toBe("알 수 없음");
  });
});
