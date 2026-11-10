import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// A broken HEIF decoder install (e.g. the wasm bundle missing from the image).
vi.mock("heic-decode", () => {
  throw new Error("Cannot find module 'libheif-js/wasm-bundle'");
});

import { ClassifierUnavailableError } from "./nsfw/classifier";
import { loadHeicDecoder, thumbnailFromOriginal } from "./original-thumbnail";

const HEIC = new Uint8Array(readFileSync(new URL("./testing/galaxy-like.heic", import.meta.url)));

describe("thumbnailFromOriginal when the HEIF decoder cannot load", () => {
  it("is ClassifierUnavailableError (infrastructure), not a per-photo failure", async () => {
    await expect(thumbnailFromOriginal(HEIC)).rejects.toBeInstanceOf(ClassifierUnavailableError);
    await expect(loadHeicDecoder()).rejects.toBeInstanceOf(ClassifierUnavailableError);
  });
});
