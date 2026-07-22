import { afterEach, describe, expect, it, vi } from "vitest";
import { type DetectedTripData, requestTripConfirmation, TripConfirmationError } from "./hooks";

const trip: DetectedTripData = {
  name: "부산",
  startDate: "2026-07-01",
  endDate: "2026-07-02",
  visitedCities: ["부산"],
  visitedCountries: ["대한민국"],
  isOverseas: false,
  totalDistanceMeters: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestTripConfirmation", () => {
  it("returns the saved count on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ saved: 2 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    await expect(requestTripConfirmation([trip], "revision-1")).resolves.toBe(2);
  });

  it("throws an explicit generic failure instead of returning a zero count", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "저장소 오류" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    await expect(requestTripConfirmation([trip], "revision-1")).rejects.toEqual(
      new TripConfirmationError("저장소 오류")
    );
  });

  it("preserves the stale detection conflict code for redetection guidance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "여행 제외 설정이 바뀌었습니다",
            code: "STALE_DETECTION",
          }),
          { status: 409, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    await expect(requestTripConfirmation([trip], "revision-1")).rejects.toMatchObject({
      message: "여행 제외 설정이 바뀌었습니다",
      code: "STALE_DETECTION",
    });
  });
});
