import { describe, expect, it } from "vitest";
import { boundsKey, boundsOf } from "./camera";

describe("boundsOf", () => {
  it("is null without points", () => {
    expect(boundsOf([])).toBeNull();
  });

  it("spans every point", () => {
    expect(
      boundsOf([
        [127.02, 37.5],
        [126.98, 37.56],
        [127.1, 37.49],
      ])
    ).toEqual([
      [126.98, 37.49],
      [127.1, 37.56],
    ]);
  });
});

describe("boundsKey", () => {
  const box = boundsOf([
    [127.02, 37.5],
    [126.98, 37.56],
  ]);

  it("is null without bounds, so there is nothing to fit", () => {
    expect(boundsKey("2026-11-08", null)).toBeNull();
  });

  it("is stable for the same box (a refetch of the same day doesn't refit)", () => {
    const again = boundsOf([
      [126.98, 37.56],
      [127.0, 37.52],
      [127.02, 37.5],
    ]);
    expect(boundsKey("2026-11-08", again)).toBe(boundsKey("2026-11-08", box));
  });

  it("ignores sub-metre float noise", () => {
    const noisy = boundsOf([
      [127.020000001, 37.5],
      [126.98, 37.559999999],
    ]);
    expect(boundsKey("2026-11-08", noisy)).toBe(boundsKey("2026-11-08", box));
  });

  it("changes with the day or a wider box", () => {
    const wider = boundsOf([
      [127.02, 37.5],
      [126.9, 37.56],
    ]);
    expect(boundsKey("2026-11-09", box)).not.toBe(boundsKey("2026-11-08", box));
    expect(boundsKey("2026-11-08", wider)).not.toBe(boundsKey("2026-11-08", box));
  });
});
