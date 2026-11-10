import { describe, expect, it } from "vitest";
import { deriveSourceStatus, SOURCE_STATUS_LABELS } from "./status";

const now = new Date("2026-11-09T13:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

describe("deriveSourceStatus", () => {
  it("applies the precedence 미연결 > 다시 연결 > 실패 > 지연 > 정상", () => {
    expect(deriveSourceStatus({ connected: false, needsReauth: true, now })).toBe("disconnected");
    expect(deriveSourceStatus({ connected: true, needsReauth: true, lastError: "x", now })).toBe(
      "reauth"
    );
    expect(
      deriveSourceStatus({ connected: true, lastError: "x", lastSuccessAt: hoursAgo(1), now })
    ).toBe("failed");
    expect(deriveSourceStatus({ connected: true, lastSuccessAt: hoursAgo(49), now })).toBe(
      "delayed"
    );
    expect(deriveSourceStatus({ connected: true, lastSuccessAt: null, now })).toBe("delayed");
    expect(deriveSourceStatus({ connected: true, lastSuccessAt: hoursAgo(7), now })).toBe("ok");
  });

  it("labels every status in Korean", () => {
    expect(Object.values(SOURCE_STATUS_LABELS)).toEqual([
      "정상",
      "지연",
      "실패",
      "다시 연결 필요",
      "미연결",
    ]);
  });
});
