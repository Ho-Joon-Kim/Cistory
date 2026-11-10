import { describe, expect, it } from "vitest";
import type { OverviewSnapshotDomains, OverviewSnapshotResponse } from "./service";
import { historyRefreshToken, overviewBodyReady, shouldShowOverviewFailure } from "./view-state";

const successfulDomain = {
  data: {},
  status: "success" as const,
  computedAt: "2026-07-22T00:00:00.000Z",
  computeVersion: 1,
  errorCode: null,
};

function readySnapshot(domains: OverviewSnapshotDomains): OverviewSnapshotResponse {
  return {
    status: "ready",
    periodType: "month",
    periodKey: "2026-07",
    computedAt: "2026-07-22T00:00:00.000Z",
    domains,
  };
}

describe("overview failure presentation", () => {
  it("surfaces a failed domain in an otherwise ready snapshot", () => {
    expect(
      shouldShowOverviewFailure(
        readySnapshot({
          coding: successfulDomain as OverviewSnapshotDomains["coding"],
          location: {
            ...successfulDomain,
            data: null,
            status: "failed",
            errorCode: "LOCATION_AGGREGATION_FAILED",
          } as OverviewSnapshotDomains["location"],
          health: null,
          spending: null,
          portfolio: null,
        })
      )
    ).toBe(true);
  });

  it("does not flag a ready snapshot without failed domains", () => {
    expect(
      shouldShowOverviewFailure(
        readySnapshot({
          coding: successfulDomain as OverviewSnapshotDomains["coding"],
          location: null,
          health: null,
          spending: null,
          portfolio: null,
        })
      )
    ).toBe(false);
  });
});

describe("historyRefreshToken", () => {
  it("does not refetch history when the snapshot was ready on load", () => {
    // Regression: null → computedAt on the first response fired a second, serial
    // history request that always landed after the hero.
    expect(historyRefreshToken(false, "2026-11-10T04:50:00.000Z")).toBeNull();
  });

  it("refetches once a pending snapshot is published while the page is open", () => {
    expect(historyRefreshToken(true, null)).toBeNull();
    expect(historyRefreshToken(true, "2026-11-10T04:50:00.000Z")).toBe("2026-11-10T04:50:00.000Z");
  });
});

describe("overviewBodyReady", () => {
  it("waits for the snapshot", () => {
    expect(
      overviewBodyReady({ snapshotReady: false, historySettled: true, graceElapsed: true })
    ).toBe(false);
  });

  it("holds the hero briefly for history so comparisons don't pop in", () => {
    expect(
      overviewBodyReady({ snapshotReady: true, historySettled: false, graceElapsed: false })
    ).toBe(false);
    expect(
      overviewBodyReady({ snapshotReady: true, historySettled: true, graceElapsed: false })
    ).toBe(true);
  });

  it("never lets a slow history request block the hero past the grace period", () => {
    expect(
      overviewBodyReady({ snapshotReady: true, historySettled: false, graceElapsed: true })
    ).toBe(true);
  });
});
