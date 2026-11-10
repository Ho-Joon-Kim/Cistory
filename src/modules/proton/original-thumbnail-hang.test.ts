import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

// A wedged libheif: the image is found but its decode never settles (a wasm
// trap inside libheif-js's timer callback leaves the promise pending forever).
const m = vi.hoisted(() => ({ dispose: vi.fn() }));
vi.mock("heic-decode", () => ({
  all: async () =>
    Object.assign([{ width: 640, height: 480, decode: () => new Promise(() => {}) }], {
      dispose: m.dispose,
    }),
}));

import { ClassifierUnavailableError } from "./nsfw/classifier";
import { HEIC_DECODE_TIMEOUT_MS, thumbnailFromOriginal } from "./original-thumbnail";

const HEIC = new Uint8Array(readFileSync(new URL("./testing/galaxy-like.heic", import.meta.url)));

afterEach(() => {
  vi.useRealTimers();
});

describe("thumbnailFromOriginal with a HEIF decode that never settles", () => {
  it("gives up after the deadline as an infrastructure failure and disposes the images", async () => {
    vi.useFakeTimers();
    const pending = thumbnailFromOriginal(HEIC);
    const settled = expect(pending).rejects.toBeInstanceOf(ClassifierUnavailableError);
    await vi.advanceTimersByTimeAsync(HEIC_DECODE_TIMEOUT_MS);
    await settled;
    expect(m.dispose).toHaveBeenCalledTimes(1);
  });
});
