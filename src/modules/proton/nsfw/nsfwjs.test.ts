import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { ClassifierUnavailableError, ClassifyInputError, type NsfwScores } from "./classifier";
import type { RgbImage } from "./decode";
import {
  buildNsfwjsClassifier,
  createNsfwjsClassifier,
  type LoadedNsfwModel,
  type NsfwPrediction,
} from "./nsfwjs";

const NEUTRAL: NsfwScores = { drawing: 0, hentai: 0, neutral: 1, porn: 0, sexy: 0 };
const NEUTRAL_ROWS: NsfwPrediction[] = [
  { className: "Neutral", probability: 1 },
  { className: "Drawing", probability: 0 },
  { className: "Hentai", probability: 0 },
  { className: "Porn", probability: 0 },
  { className: "Sexy", probability: 0 },
];

/** A fake model; `predict` defaults to a valid neutral result. */
function fakeModel(
  predict: (image: RgbImage) => Promise<NsfwPrediction[]> = async () => NEUTRAL_ROWS,
  backend = "wasm"
): LoadedNsfwModel & { disposed: number } {
  const model = {
    backend,
    disposed: 0,
    predict,
    dispose() {
      model.disposed++;
    },
  };
  return model;
}

/** An image the canary (8×8) can be told apart from. */
const isCanary = (image: RgbImage) => image.width === 8 && image.height === 8;

describe("buildNsfwjsClassifier load lifecycle", () => {
  it("surfaces a load failure as ClassifierUnavailableError and retries on the next call", async () => {
    const model = fakeModel();
    let calls = 0;
    const classifier = buildNsfwjsClassifier(async () => {
      calls++;
      if (calls === 1) throw new Error("wasm OOM");
      return model;
    });
    const jpegBytes = grayJpeg(16);

    await expect(classifier.classify(jpegBytes)).rejects.toBeInstanceOf(ClassifierUnavailableError);
    expect(classifier.backend).toBeNull();
    await expect(classifier.classify(jpegBytes)).resolves.toEqual(NEUTRAL);
    await expect(classifier.classify(jpegBytes)).resolves.toEqual(NEUTRAL);
    expect(calls).toBe(2);
  });

  it("exposes the backend the model loaded on", async () => {
    const classifier = buildNsfwjsClassifier(async () => fakeModel(undefined, "cpu"));
    expect(classifier.backend).toBeNull();
    await classifier.classify(grayJpeg(16));
    expect(classifier.backend).toBe("cpu");
  });

  it("does not load the model for an undecodable image", async () => {
    let calls = 0;
    const classifier = buildNsfwjsClassifier(async () => {
      calls++;
      return fakeModel();
    });
    await expect(classifier.classify(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(
      ClassifyInputError
    );
    expect(calls).toBe(0);
  });

  it("passes the decoded RGB image (height, width, 3 channels) to the model", async () => {
    const seen: Array<[number, number, number]> = [];
    const classifier = buildNsfwjsClassifier(async () =>
      fakeModel(async ({ width, height, data }) => {
        seen.push([width, height, data.length]);
        return NEUTRAL_ROWS;
      })
    );
    await classifier.classify(grayJpeg(16));
    expect(seen).toEqual([[16, 16, 16 * 16 * 3]]);
  });
});

describe("buildNsfwjsClassifier predict failures", () => {
  it("is ClassifierUnavailableError when the canary fails too, and the next call reloads", async () => {
    const models: Array<ReturnType<typeof fakeModel>> = [];
    let broken = true;
    const classifier = buildNsfwjsClassifier(async () => {
      const m = fakeModel(async () => {
        if (broken) throw new Error("Aborted()");
        return NEUTRAL_ROWS;
      });
      models.push(m);
      return m;
    });

    await expect(classifier.classify(grayJpeg(16))).rejects.toBeInstanceOf(
      ClassifierUnavailableError
    );
    // Original model dropped, one reload for the canary, which was dropped too.
    expect(models.map((m) => m.disposed)).toEqual([1, 1]);
    expect(classifier.backend).toBeNull();

    broken = false;
    await expect(classifier.classify(grayJpeg(16))).resolves.toEqual(NEUTRAL);
    expect(models).toHaveLength(3);
  });

  it("is ClassifierUnavailableError when the reload for the canary fails", async () => {
    let loads = 0;
    const classifier = buildNsfwjsClassifier(async () => {
      loads++;
      if (loads > 1) throw new Error("wasm OOM");
      return fakeModel(async () => {
        throw new Error("lost backend");
      });
    });
    await expect(classifier.classify(grayJpeg(16))).rejects.toBeInstanceOf(
      ClassifierUnavailableError
    );
    expect(loads).toBe(2);
  });

  it("is ClassifyInputError when the canary passes on a fresh model", async () => {
    const seen: string[] = [];
    let loads = 0;
    const classifier = buildNsfwjsClassifier(async () => {
      loads++;
      return fakeModel(async (image) => {
        seen.push(isCanary(image) ? "canary" : "photo");
        if (!isCanary(image)) throw new Error("bad image");
        return NEUTRAL_ROWS;
      });
    });
    await expect(classifier.classify(grayJpeg(16))).rejects.toBeInstanceOf(ClassifyInputError);
    expect(seen).toEqual(["photo", "canary"]);
    expect(loads).toBe(2);
    // The healthy reloaded model is kept for the next photo.
    await expect(classifier.classify(grayJpeg(16))).rejects.toBeInstanceOf(ClassifyInputError);
    expect(loads).toBe(3);
  });
});

describe("buildNsfwjsClassifier malformed model output fails closed", () => {
  const row = (className: string, probability: number) => ({ className, probability });
  const cases: Array<[string, NsfwPrediction[]]> = [
    ["an empty prediction list", []],
    ["a missing class", NEUTRAL_ROWS.slice(0, 4)],
    [
      "a duplicate class",
      [row("Neutral", 0.5), row("Neutral", 0.5), row("Drawing", 0), row("Porn", 0), row("Sexy", 0)],
    ],
    [
      "an unknown class name",
      [row("Safe", 1), row("Drawing", 0), row("Hentai", 0), row("Porn", 0), row("Sexy", 0)],
    ],
    [
      "a NaN probability",
      [
        row("Neutral", 1),
        row("Drawing", 0),
        row("Hentai", 0),
        row("Porn", Number.NaN),
        row("Sexy", 0),
      ],
    ],
    [
      "an Infinity probability",
      [
        row("Neutral", 1),
        row("Drawing", 0),
        row("Hentai", 0),
        row("Porn", 0),
        row("Sexy", Infinity),
      ],
    ],
    [
      "a probability outside [0, 1]",
      [row("Neutral", 1.2), row("Drawing", -0.2), row("Hentai", 0), row("Porn", 0), row("Sexy", 0)],
    ],
    [
      "a total off 1 by more than 0.02",
      [
        row("Neutral", 0.9),
        row("Drawing", 0.05),
        row("Hentai", 0.02),
        row("Porn", 0),
        row("Sexy", 0),
      ],
    ],
  ];

  it.each(cases)("throws ClassifierUnavailableError on %s", async (_name, rows) => {
    const model = fakeModel(async () => rows);
    const classifier = buildNsfwjsClassifier(async () => model);
    await expect(classifier.classify(grayJpeg(16))).rejects.toBeInstanceOf(
      ClassifierUnavailableError
    );
    expect(model.disposed).toBe(1);
  });

  it("accepts a total within 0.02 of 1", async () => {
    const rows = [
      row("Neutral", 0.9),
      row("Drawing", 0.05),
      row("Hentai", 0.03),
      row("Porn", 0.005),
      row("Sexy", 0),
    ];
    const classifier = buildNsfwjsClassifier(async () => fakeModel(async () => rows));
    await expect(classifier.classify(grayJpeg(16))).resolves.toEqual({
      neutral: 0.9,
      drawing: 0.05,
      hentai: 0.03,
      porn: 0.005,
      sexy: 0,
    });
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
    const classifier = createNsfwjsClassifier();
    await classifier.classify(grayJpeg(32));
    expect(classifier.backend).toBe("wasm");
    const tf = await import("@tensorflow/tfjs");
    expect(tf.getBackend()).toBe("wasm");
  }, 120_000);

  it("classifies an image the size of the 8×8 canary on the real model", async () => {
    const scores = await createNsfwjsClassifier().classify(grayJpeg(8));
    expect(Object.values(scores).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
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
