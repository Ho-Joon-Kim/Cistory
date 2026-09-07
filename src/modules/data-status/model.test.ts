import { describe, expect, it } from "vitest";
import { buildSourceDays, isSourceStale, validateStatusRange } from "./model";
import type { RecoveryJob } from "./types";

const now = new Date("2026-09-07T02:00:00Z");
const job: RecoveryJob = {
  id: "job",
  source: "wakatime",
  fromDate: "2026-09-01",
  toDate: "2026-09-03",
  nextDate: "2026-09-02",
  status: "failed",
  error: "failed",
  createdAt: now.toISOString(),
};
describe("source collection evidence", () => {
  it("does not call an empty day a collection failure", () => {
    expect(buildSourceDays("location", "2026-09-01", "2026-09-01", new Map(), [job])[0].state).toBe(
      "unknown"
    );
  });
  it("distinguishes a completed empty day, failed day and unchecked tail", () => {
    expect(
      buildSourceDays("wakatime", job.fromDate, job.toDate, new Map(), [job]).map((d) => d.state)
    ).toEqual(["checked", "failed", "unknown"]);
  });
  it("keeps actual records visible after successful recheck", () => {
    expect(
      buildSourceDays("wakatime", job.fromDate, job.fromDate, new Map([[job.fromDate, 2]]), [
        job,
      ])[0]
    ).toMatchObject({ count: 2, state: "observed" });
  });
  it("uses newer retry evidence", () => {
    expect(
      buildSourceDays("wakatime", job.fromDate, job.toDate, new Map(), [
        { ...job, status: "pending", nextDate: job.fromDate },
        job,
      ]).every((d) => d.state === "pending")
    ).toBe(true);
  });
  it("bounds valid ranges and rejects future/impossible dates", () => {
    expect(validateStatusRange("2026-08-08", "2026-09-07", now)).toBe(true);
    for (const [from, to] of [
      ["2026-08-07", "2026-09-07"],
      ["2026-09-08", "2026-09-08"],
      ["2026-02-30", "2026-03-01"],
      ["2026-09-02", "2026-09-01"],
    ])
      expect(validateStatusRange(from, to, now)).toBe(false);
  });
  it("does not invent freshness before any successful sync", () => {
    expect(isSourceStale(true, null, now)).toBe(false);
    expect(isSourceStale(true, "2026-09-01T00:00:00Z", now)).toBe(true);
    expect(isSourceStale(false, "2026-09-01T00:00:00Z", now)).toBe(false);
  });
});
