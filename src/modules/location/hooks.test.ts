import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type DetectedTripData,
  locationDayOptions,
  requestTripConfirmation,
  TripConfirmationError,
} from "./hooks";

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

describe("locationDayOptions", () => {
  // 2026-11-10 10:00 KST
  const now = new Date("2026-11-10T01:00:00Z");
  const fetcher = async () => [];

  it("keys each kind and day in the shared cache, so a return to /dashboard reuses it", () => {
    const a = locationDayOptions("points", "2026-11-08", "2026-11-08", fetcher, now);
    const b = locationDayOptions("tracks", "2026-11-08", "2026-11-08", fetcher, now);
    const c = locationDayOptions("points", "2026-11-09", "2026-11-09", fetcher, now);
    expect(a.queryKey).toEqual(["location", "points", "2026-11-08", "2026-11-08"]);
    expect(new Set([a, b, c].map((o) => JSON.stringify(o.queryKey))).size).toBe(3);
  });

  it("polls only a range that includes today (KST)", () => {
    expect(locationDayOptions("points", "2026-11-10", "2026-11-10", fetcher, now)).toMatchObject({
      refetchInterval: 60_000,
      staleTime: 30_000,
    });
    expect(
      locationDayOptions("distances", "2026-11-04", "2026-11-10", fetcher, now).refetchInterval
    ).toBe(60_000);
    // 2026-11-10 00:30 KST is still "2026-11-09" in UTC — today must be the KST day.
    const justAfterMidnight = new Date("2026-11-09T15:30:00Z");
    expect(
      locationDayOptions("points", "2026-11-09", "2026-11-09", fetcher, justAfterMidnight)
        .refetchInterval
    ).toBe(false);
  });

  it("keeps a past day fresh for longer and never polls it", () => {
    expect(
      locationDayOptions("stay-points", "2026-11-08", "2026-11-08", fetcher, now)
    ).toMatchObject({ refetchInterval: false, staleTime: 5 * 60_000 });
  });

  it("doesn't retry, so a failing source never holds the day's skeleton", () => {
    expect(locationDayOptions("points", "2026-11-08", "2026-11-08", fetcher, now).retry).toBe(
      false
    );
  });

  it("stays idle without a date", () => {
    expect(locationDayOptions("points", "", "", fetcher, now).enabled).toBe(false);
  });
});
