import { describe, expect, it } from "vitest";
import { evidenceMatches } from "@/lib/facts/evidence";
import { evidenceTag, tagEvidence, tagFamily } from "./evidence-tag";

describe("evidence tags", () => {
  it("adds one tag key that no host key matches", () => {
    const e = tagEvidence({ kind: "keys", keys: ["2026-10", "2026-02"] }, "steps");
    expect(evidenceTag(e)).toBe("steps");
    expect(evidenceMatches(e, "2026-10")).toBe(true);
    expect(evidenceMatches(e, "@steps")).toBe(true);
    expect(evidenceMatches(e, "2026-03")).toBe(false);
  });

  it("replaces an earlier tag instead of stacking", () => {
    const e = tagEvidence(tagEvidence({ kind: "keys", keys: ["a"] }, "commits"), "cash.income");
    expect(e).toEqual({ kind: "keys", keys: ["a", "@cash.income"] });
    expect(tagFamily("cash.income")).toBe("cash");
  });

  it("expands a day range so it can carry a tag", () => {
    const e = tagEvidence({ kind: "range", from: "2026-10-30", to: "2026-11-01" }, "commits");
    expect(e).toEqual({
      kind: "keys",
      keys: ["2026-10-30", "2026-10-31", "2026-11-01", "@commits"],
    });
  });

  it("leaves untagged evidence untagged", () => {
    expect(evidenceTag({ kind: "range", from: "2026-01", to: "2026-03" })).toBeNull();
    expect(evidenceTag(null)).toBeNull();
  });
});
