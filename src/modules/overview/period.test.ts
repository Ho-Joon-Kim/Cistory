// Production containers use KST, and period keys are local-calendar values.
process.env.TZ = "Asia/Seoul";

import { describe, expect, it } from "vitest";
import {
  getPeriodKey,
  getPeriodRange,
  isPeriodActive,
  recoverExpiredPeriodSnapshotLease,
} from "./period";

describe("period keys and ranges", () => {
  it("uses the Monday-to-Monday ISO week containing a KST date", () => {
    const date = new Date("2026-07-21T15:30:00Z"); // 2026-07-22 00:30 KST

    expect(getPeriodKey("week", date)).toBe("2026-W30");
    expect(getPeriodRange("week", "2026-W30")).toEqual({
      from: new Date("2026-07-19T15:00:00Z"),
      toExclusive: new Date("2026-07-26T15:00:00Z"),
    });
  });

  it("keeps the ISO week-year consistent across a calendar-year boundary", () => {
    const date = new Date("2026-12-30T15:30:00Z"); // 2026-12-31 00:30 KST

    expect(getPeriodKey("week", date)).toBe("2026-W53");
    expect(getPeriodKey("week", new Date("2026-12-31T15:30:00Z"))).toBe("2026-W53");
    expect(getPeriodRange("week", "2026-W53")).toEqual({
      from: new Date("2026-12-27T15:00:00Z"),
      toExclusive: new Date("2027-01-03T15:00:00Z"),
    });
  });

  it("does not move KST midnight-to-09:00 instants to the previous UTC day", () => {
    const kstMorning = new Date("2026-07-21T16:00:00Z"); // 2026-07-22 01:00 KST

    expect(getPeriodKey("recent", kstMorning)).toBe("2026-07-22");
    expect(getPeriodKey("month", kstMorning)).toBe("2026-07");
    expect(getPeriodKey("year", kstMorning)).toBe("2026");
  });

  it("builds a 14-day recent window including its keyed end date", () => {
    const range = getPeriodRange("recent", "2026-07-22");

    expect(range).toEqual({
      from: new Date("2026-07-08T15:00:00Z"),
      toExclusive: new Date("2026-07-22T15:00:00Z"),
    });
    expect(range.toExclusive.getTime() - range.from.getTime()).toBe(14 * 86_400_000);
  });
});

describe("period lifecycle", () => {
  it("classifies a month containing now as active and the prior month as completed", () => {
    const now = new Date("2026-07-22T00:00:00Z");

    expect(isPeriodActive("month", "2026-07", now)).toBe(true);
    expect(isPeriodActive("month", "2026-06", now)).toBe(false);
  });

  it("recovers an expired computing lease without resetting its attempt count", () => {
    const snapshot = {
      status: "computing" as const,
      computeStartedAt: new Date("2026-07-22T00:00:00Z"),
      leaseExpiresAt: new Date("2026-07-22T00:05:00Z"),
      attemptCount: 3,
    };

    expect(recoverExpiredPeriodSnapshotLease(snapshot, new Date("2026-07-22T00:06:00Z"))).toEqual({
      status: "pending",
      computeStartedAt: null,
      leaseExpiresAt: null,
      attemptCount: 3,
    });
  });

  it("leaves an unexpired computing lease unchanged", () => {
    const snapshot = {
      status: "computing" as const,
      computeStartedAt: new Date("2026-07-22T00:00:00Z"),
      leaseExpiresAt: new Date("2026-07-22T00:05:00Z"),
      attemptCount: 3,
    };

    expect(recoverExpiredPeriodSnapshotLease(snapshot, new Date("2026-07-22T00:04:00Z"))).toBe(
      snapshot
    );
  });
});
