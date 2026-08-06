import { describe, expect, it } from "vitest";
import {
  isValidTripDateRange,
  TRIP_DATA_HORIZON,
} from "../src/modules/location/services/trip-detector";
import { resolveArgs } from "./detect-trips";

// Regression coverage for the bug this script shipped with: the old
// hardcoded "2020-01-01" default `from` produced a ~2409-day span against
// today, which isValidTripDateRange always rejects (the cap is the data
// horizon through today plus one year of headroom, ~883 days as of writing).
// That made the header's "safe to ... backfill the full history once" claim
// false at the script's own documented defaults.
describe("resolveArgs", () => {
  it("defaults `from` to the data horizon, which combined with the default `to` is a valid detection range", () => {
    const result = resolveArgs(["user-1"]);

    if ("error" in result) throw new Error("expected a resolved range, got an error");
    expect(result.from).toBe(TRIP_DATA_HORIZON);
    expect(isValidTripDateRange(result.from, result.to)).toBe(true);
  });

  it("errors instead of resolving when userId is missing", () => {
    const result = resolveArgs([]);
    expect(result).toHaveProperty("error");
  });

  it("uses explicit from/to over the defaults when both are provided", () => {
    const result = resolveArgs(["user-1", "2025-06-01", "2025-06-10"]);
    expect(result).toEqual({ userId: "user-1", from: "2025-06-01", to: "2025-06-10" });
  });

  it("uses an explicit `from` with the default `to` when only `from` is provided", () => {
    const result = resolveArgs(["user-1", "2025-06-01"]);
    if ("error" in result) throw new Error("expected a resolved range, got an error");
    expect(result.from).toBe("2025-06-01");
    expect(result.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
