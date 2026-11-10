import { describe, expect, it, vi } from "vitest";

// A missing or broken native binding (e.g. no linuxmusl build in the image).
vi.mock("sharp", () => {
  throw new Error("Could not load the sharp module");
});

import { ClassifierUnavailableError } from "./classifier";
import { decodeToRgb } from "./decode";
import { buildNsfwjsClassifier } from "./nsfwjs";

const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

describe("decodeToRgb when sharp cannot load", () => {
  it("is ClassifierUnavailableError, so no per-photo attempt is burned", async () => {
    await expect(decodeToRgb(JPEG_MAGIC)).rejects.toBeInstanceOf(ClassifierUnavailableError);
  });

  it("propagates through the classifier without loading the model", async () => {
    const load = vi.fn();
    await expect(buildNsfwjsClassifier(load).classify(JPEG_MAGIC)).rejects.toBeInstanceOf(
      ClassifierUnavailableError
    );
    expect(load).not.toHaveBeenCalled();
  });
});
