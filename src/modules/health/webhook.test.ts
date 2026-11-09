import { describe, expect, it } from "vitest";
import {
  intervalToRange,
  isVerificationRequest,
  parseNotifications,
  signatureMode,
} from "./webhook";
import { planWindow, WEBHOOK_MAX_WINDOW_MS, type WebhookClaim } from "./webhook-queue";

describe("intervalToRange", () => {
  it("prefers the physical (UTC) interval", () => {
    expect(
      intervalToRange({
        physicalTimeInterval: {
          startTime: "2026-03-08T01:29:00Z",
          endTime: "2026-03-08T01:34:00Z",
        },
        civilIso8601TimeInterval: {
          startTime: "2026-03-07T17:29:00",
          endTime: "2026-03-07T17:34:00",
        },
      })
    ).toEqual({ start: new Date("2026-03-08T01:29:00Z"), end: new Date("2026-03-08T01:34:00Z") });
  });

  it("reads a civil-only daily interval as KST day boundaries", () => {
    const r = intervalToRange({
      civilIso8601TimeInterval: {
        startTime: "2026-07-14T00:00:00",
        endTime: "2026-07-15T00:00:00",
      },
    });
    expect(r?.start.toISOString()).toBe("2026-07-13T15:00:00.000Z");
    expect(r?.end.toISOString()).toBe("2026-07-14T15:00:00.000Z");
  });

  it("falls back to civilDateTimeInterval objects (time may be empty)", () => {
    const r = intervalToRange({
      civilDateTimeInterval: {
        startDateTime: { date: { year: 2026, month: 3, day: 7 }, time: { hours: 17, minutes: 29 } },
        endDateTime: { date: { year: 2026, month: 3, day: 8 }, time: {} },
      },
    });
    expect(r?.start.toISOString()).toBe("2026-03-07T08:29:00.000Z");
    expect(r?.end.toISOString()).toBe("2026-03-07T15:00:00.000Z");
  });

  it("rejects malformed or inverted intervals", () => {
    expect(intervalToRange(null)).toBeNull();
    expect(intervalToRange({ civilIso8601TimeInterval: { startTime: "garbage" } })).toBeNull();
    expect(
      intervalToRange({
        physicalTimeInterval: {
          startTime: "2026-03-08T02:00:00Z",
          endTime: "2026-03-08T01:00:00Z",
        },
      })
    ).toBeNull();
  });
});

describe("parseNotifications", () => {
  const item = (data: Record<string, unknown>) => ({ data });
  const interval = {
    physicalTimeInterval: { startTime: "2026-03-08T01:29:00Z", endTime: "2026-03-08T01:34:00Z" },
  };

  it("handles arrays and single objects, keeping recordId and operation", () => {
    const one = parseNotifications(
      item({
        healthUserId: "1",
        dataType: "sleep",
        operation: "DELETE",
        recordId: "9875412",
        intervals: [interval],
      })
    );
    expect(one.notifications[0]).toMatchObject({
      operation: "DELETE",
      recordId: "9875412",
      dataType: "sleep",
    });
    const many = parseNotifications([
      item({ healthUserId: "1", dataType: "steps", intervals: [interval, interval] }),
    ]);
    expect(many.notifications[0].intervals).toHaveLength(2);
    expect(many.notifications[0].operation).toBe("UPSERT");
    expect(many.notifications[0].recordId).toBe("");
  });

  it("counts items without a user, type or usable interval as dropped", () => {
    const out = parseNotifications([
      item({ dataType: "steps", intervals: [interval] }),
      item({ healthUserId: "1", intervals: [interval] }),
      item({ healthUserId: "1", dataType: "steps", intervals: [] }),
      "junk",
    ]);
    expect(out).toEqual({ notifications: [], dropped: 4 });
  });
});

describe("isVerificationRequest / signatureMode", () => {
  it("recognizes only the object-form verification probe", () => {
    expect(isVerificationRequest({ type: "verification" })).toBe(true);
    expect(isVerificationRequest([{ type: "verification" }])).toBe(false);
    expect(isVerificationRequest({ data: {} })).toBe(false);
  });

  it("defaults to log-only and only enforces on the exact value", () => {
    expect(signatureMode({})).toBe("log-only");
    expect(signatureMode({ GOOGLE_HEALTH_WEBHOOK_SIGNATURE_MODE: "ENFORCE" })).toBe("log-only");
    expect(signatureMode({ GOOGLE_HEALTH_WEBHOOK_SIGNATURE_MODE: "enforce" })).toBe("enforce");
  });
});

describe("planWindow", () => {
  const claim = (start: string, end: string) =>
    ({ rangeStart: new Date(start), rangeEnd: new Date(end) }) as WebhookClaim;

  it("merges intervals into one padded window", () => {
    const plan = planWindow([
      claim("2026-11-09T05:00:00Z", "2026-11-09T05:05:00Z"),
      claim("2026-11-09T01:00:00Z", "2026-11-09T01:05:00Z"),
    ]);
    expect(plan.take).toHaveLength(2);
    expect(plan.defer).toHaveLength(0);
    expect(plan.start.toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(plan.end.toISOString()).toBe("2026-11-09T06:05:00.000Z");
  });

  it("defers what doesn't fit in one 14-day read", () => {
    const plan = planWindow([
      claim("2026-10-01T00:00:00Z", "2026-10-01T01:00:00Z"),
      claim("2026-10-10T00:00:00Z", "2026-10-10T01:00:00Z"),
      claim("2026-11-09T00:00:00Z", "2026-11-09T01:00:00Z"),
    ]);
    expect(plan.take).toHaveLength(2);
    expect(plan.defer).toHaveLength(1);
  });

  it("clamps a single over-long interval to its most recent 14 days", () => {
    const plan = planWindow([claim("2026-01-01T00:00:00Z", "2026-11-01T00:00:00Z")]);
    expect(plan.take).toHaveLength(1);
    expect(plan.end.getTime() - plan.start.getTime()).toBe(WEBHOOK_MAX_WINDOW_MS + 2 * 3600_000);
  });
});
