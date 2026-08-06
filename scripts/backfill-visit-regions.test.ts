import { describe, expect, it } from "vitest";
import { parseUserIdArgs } from "./lib/backfill-args";

// Covers the same review findings backfill-tracks.test.ts guards for a
// similarly destructive script: this one repairs place_cache.region/country
// and visits.city/country_name for real users, so a typo'd --dry-run must
// never silently resolve to a live run.

describe("parseUserIdArgs", () => {
  it("parses a valid dry run", () => {
    const result = parseUserIdArgs(["u1", "--dry-run"]);
    expect(result).toEqual({ userId: "u1", dryRun: true });
  });

  it("parses a valid live run (no flag)", () => {
    const result = parseUserIdArgs(["u1"]);
    expect(result).toEqual({ userId: "u1", dryRun: false });
  });

  // The reviewer pattern from backfill-args.test.ts's sibling coverage:
  // each of these must resolve to a loud error, never a silent live run —
  // i.e. never `{ userId: "u1", dryRun: false }`.
  const dryRunTypos = ["--dryrun", "-dry-run", "--Dry-Run", " --dry-run"];

  for (const typo of dryRunTypos) {
    it(`rejects the typo'd flag ${JSON.stringify(typo)} as an error, not a silent live run`, () => {
      const result = parseUserIdArgs(["u1", typo]);

      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toBeTruthy();

      // The specific failure mode under test: it must NOT be the shape a
      // silent live run would produce.
      expect(result).not.toEqual({ userId: "u1", dryRun: false });
      expect(result).not.toHaveProperty("dryRun", false);
    });
  }

  it("errors on too few positionals (no userId)", () => {
    const result = parseUserIdArgs([]);
    expect(result).toHaveProperty("error");
    expect(result).not.toHaveProperty("dryRun", false);
  });

  it("errors on too few positionals (--dry-run only, no userId)", () => {
    const result = parseUserIdArgs(["--dry-run"]);
    expect(result).toHaveProperty("error");
  });

  it("errors on too many positionals", () => {
    const result = parseUserIdArgs(["u1", "u2"]);
    expect(result).toHaveProperty("error");
  });

  it("errors on an unknown flag such as --force", () => {
    const result = parseUserIdArgs(["u1", "--force"]);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/--force/);
  });

  it("errors on an unknown flag even when the positional is otherwise valid", () => {
    // Guards the exact bug shape: 1 good positional + one bad token that
    // must not just fall off the end of a destructure.
    const result = parseUserIdArgs(["--force", "u1"]);
    expect(result).toHaveProperty("error");
  });
});
