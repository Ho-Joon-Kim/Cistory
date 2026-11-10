import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { ClassifierUnavailableError, ClassifyInputError, type NsfwScores } from "./classifier";
import { buildNsfwjsClassifier, createNsfwjsClassifier, type LoadedNsfwModel } from "./nsfwjs";

const NEUTRAL: NsfwScores = { drawing: 0, hentai: 0, neutral: 1, porn: 0, sexy: 0 };

describe("buildNsfwjsClassifier load lifecycle", () => {
  it("surfaces a load failure as ClassifierUnavailableError and retries on the next call", async () => {
    const model: LoadedNsfwModel = { predict: async () => NEUTRAL };
    let calls = 0;
    const classifier = buildNsfwjsClassifier(async () => {
      calls++;
      if (calls === 1) throw new Error("wasm OOM");
      return model;
    });
    const jpegBytes = grayJpeg(16);

    await expect(classifier.classify(jpegBytes)).rejects.toBeInstanceOf(ClassifierUnavailableError);
    await expect(classifier.classify(jpegBytes)).resolves.toEqual(NEUTRAL);
    await expect(classifier.classify(jpegBytes)).resolves.toEqual(NEUTRAL);
    expect(calls).toBe(2);
  });

  it("does not load the model for an undecodable image", async () => {
    let calls = 0;
    const classifier = buildNsfwjsClassifier(async () => {
      calls++;
      return { predict: async () => NEUTRAL };
    });
    await expect(classifier.classify(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(
      ClassifyInputError
    );
    expect(calls).toBe(0);
  });

  it("passes the decoded RGB image (height, width, 3 channels) to the model", async () => {
    const seen: Array<[number, number, number]> = [];
    const classifier = buildNsfwjsClassifier(async () => ({
      predict: async ({ width, height, data }) => {
        seen.push([width, height, data.length]);
        return NEUTRAL;
      },
    }));
    await classifier.classify(grayJpeg(16));
    expect(seen).toEqual([[16, 16, 16 * 16 * 3]]);
  });
});

// Real model, real backend: proves the bundled MobileNetV2 loads on the tfjs
// wasm backend (or the cpu fallback) under Node 24 — including the Alpine/musl
// `tester` Docker stage, which runs this same file.

function grayJpeg(width: number, height = width): Uint8Array {
  const data = Buffer.alloc(width * height * 4, 128);
  return new Uint8Array(jpeg.encode({ width, height, data }, 90).data);
}

describe("createNsfwjsClassifier", () => {
  it("loads the bundled MobileNetV2 and returns five probabilities summing to ~1", async () => {
    const classifier = createNsfwjsClassifier();
    expect(classifier.modelVersion).toBe("nsfwjs@4.4.0/MobileNetV2");
    const scores = await classifier.classify(grayJpeg(224));
    expect(Object.keys(scores).sort()).toEqual(["drawing", "hentai", "neutral", "porn", "sexy"]);
    for (const v of Object.values(scores)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(Object.values(scores).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
  }, 120_000);

  it("runs on the wasm backend, not the cpu fallback", async () => {
    await createNsfwjsClassifier().classify(grayJpeg(32));
    const tf = await import("@tensorflow/tfjs");
    expect(tf.getBackend()).toBe("wasm");
  }, 120_000);

  it("is memoized: every call returns the same classifier", () => {
    expect(createNsfwjsClassifier()).toBe(createNsfwjsClassifier());
  });

  it("classifies a non-square thumbnail", async () => {
    const scores = await createNsfwjsClassifier().classify(grayJpeg(160, 120));
    expect(Object.values(scores).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
  }, 120_000);

  it("wraps non-JPEG input in ClassifyInputError, not ClassifierUnavailableError", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const err = await createNsfwjsClassifier()
      .classify(png)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ClassifyInputError);
    expect(err).not.toBeInstanceOf(ClassifierUnavailableError);
  }, 120_000);
});
