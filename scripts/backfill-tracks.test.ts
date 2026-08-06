import { describe, expect, it } from "vitest";
import { parseArgs, resolveDateRange } from "./lib/backfill-args";

// Covers the two review findings on this script before it's used to
// regenerate `tracks` + `transportation_segments` for 187 days of real
// data: (1) a typo'd --dry-run must never silently resolve to a live run,
// and (2) a reversed/invalid date range must never silently resolve to a
// "successful" zero-day run.

describe("parseArgs", () => {
  it("parses a valid dry run", () => {
    const result = parseArgs(["u1", "2026-07-01", "2026-07-07", "--dry-run"]);
    expect(result).toEqual({
      userId: "u1",
      fromDate: "2026-07-01",
      toDate: "2026-07-07",
      dryRun: true,
    });
  });

  it("parses a valid live run (no flag)", () => {
    const result = parseArgs(["u1", "2026-07-01", "2026-07-07"]);
    expect(result).toEqual({
      userId: "u1",
      fromDate: "2026-07-01",
      toDate: "2026-07-07",
      dryRun: false,
    });
  });

  // The reviewer reproduced all four of these resolving to `dryRun: false`
  // with otherwise-valid positionals under the old `.includes("--dry-run")`
  // + filter parsing — i.e. a silent live run. Each must now be a loud
  // error, and specifically not `{ dryRun: false, userId: "u1", ... }`.
  const dryRunTypos = ["--dryrun", "-dry-run", "--Dry-Run", " --dry-run"];

  for (const typo of dryRunTypos) {
    it(`rejects the typo'd flag ${JSON.stringify(typo)} as an error, not a silent live run`, () => {
      const result = parseArgs(["u1", "2026-07-01", "2026-07-07", typo]);

      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toBeTruthy();

      // The specific failure mode under test: it must NOT be the shape a
      // silent live run would produce.
      expect(result).not.toEqual({
        userId: "u1",
        fromDate: "2026-07-01",
        toDate: "2026-07-07",
        dryRun: false,
      });
      expect(result).not.toHaveProperty("dryRun", false);
    });
  }

  it("errors on too few positionals", () => {
    const result = parseArgs(["u1", "2026-07-01"]);
    expect(result).toHaveProperty("error");
  });

  it("errors on too many positionals", () => {
    const result = parseArgs(["u1", "2026-07-01", "2026-07-07", "extra"]);
    expect(result).toHaveProperty("error");
  });

  it("errors on an unknown flag such as --force", () => {
    const result = parseArgs(["u1", "2026-07-01", "2026-07-07", "--force"]);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/--force/);
  });

  it("errors on an unknown flag even when positionals are otherwise valid and complete", () => {
    // Guards the exact bug shape: 3 good positionals + one bad token that
    // must not just fall off the end of a destructure.
    const result = parseArgs(["--force", "u1", "2026-07-01", "2026-07-07"]);
    expect(result).toHaveProperty("error");
  });
});

describe("resolveDateRange", () => {
  it("returns the day list for a valid forward range", () => {
    const result = resolveDateRange("2026-07-01", "2026-07-07");
    expect(result).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
      "2026-07-06",
      "2026-07-07",
    ]);
  });

  it("returns a single-day range when from === to", () => {
    const result = resolveDateRange("2026-07-01", "2026-07-01");
    expect(result).toEqual(["2026-07-01"]);
  });

  it("errors on a reversed range instead of silently returning zero days", () => {
    const result = resolveDateRange("2026-07-05", "2026-07-01");
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/reversed/i);
    expect(result).not.toEqual([]);
  });

  it("errors on an unparseable fromDate", () => {
    const result = resolveDateRange("not-a-date", "2026-07-07");
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/fromDate/);
  });

  it("errors on an unparseable toDate", () => {
    const result = resolveDateRange("2026-07-01", "not-a-date");
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/toDate/);
  });
});
