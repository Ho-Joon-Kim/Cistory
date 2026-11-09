import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `coding.weekdayHour.weekdays` is a bare 7-number array indexed by Postgres
 * EXTRACT(DOW) — 0 = Sunday. Nothing in the snapshot JSON says so, and the
 * October 2026 narrative read it Monday-first: it called 목·금 (867·951) the
 * heaviest days and 수 (473) the lightest, when those are 수·목 and 화. The
 * chart labels it correctly; the model needs the convention spelled out.
 */
describe("overview narrative prompts", () => {
  for (const period of ["week", "month", "year"]) {
    it(`${period} prompt states the Sunday-first weekday index convention`, () => {
      const prompt = readFileSync(
        join(process.cwd(), "prompts", `overview-narrative-${period}.txt`),
        "utf8"
      );
      expect(prompt).toContain("weekdayHour.weekdays");
      expect(prompt).toContain("0=일요일");
      expect(prompt).toContain("6=토요일");
    });
  }
});
