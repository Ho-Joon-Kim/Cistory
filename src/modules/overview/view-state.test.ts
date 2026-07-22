import { describe, expect, it } from "vitest";
import type { OverviewSnapshotDomains, OverviewSnapshotResponse } from "./service";
import { shouldShowOverviewFailure } from "./view-state";

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
