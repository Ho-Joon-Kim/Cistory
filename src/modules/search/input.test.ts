import { describe, expect, it } from "vitest";
import { parseSearchInput } from "./input";

describe("record search input", () => {
  it("defaults to the last 30 KST calendar days", () => {
    expect(parseSearchInput(new URLSearchParams(), new Date("2026-09-06T16:00:00Z"))).toEqual({
      q: "",
      from: "2026-08-09",
      to: "2026-09-07",
      source: "all",
      page: 1,
    });
  });
  it.each([
    "from=2026-02-30",
    "to=nope",
    "from=2026-09-03&to=2026-09-01",
    "from=2025-01-01&to=2026-01-02",
    "page=0",
    "page=101",
    "page=1.5",
    "page=1e1",
    "source=other",
    `q=${"a".repeat(201)}`,
  ])("rejects invalid or unbounded input: %s", (query) => {
    expect(() => parseSearchInput(new URLSearchParams(query))).toThrow();
  });
  it("keeps literal wildcard characters and accepts 366 inclusive days", () => {
    expect(
      parseSearchInput(new URLSearchParams("q=100%25_%5C&from=2025-01-01&to=2026-01-01"))
    ).toMatchObject({ q: "100%_\\", source: "all" });
  });
});
