/**
 * Local NSFWJS (MobileNetV2) classifier on the TensorFlow.js wasm backend.
 *
 * Runs only in the cron process, so photos never leave the server. Production
 * is Node 24 on Alpine (musl), which rules out glibc-only native backends
 * (tfjs-node, onnxruntime-node); wasm is portable and a pure-JS `cpu` backend
 * is the fallback. The model weights ship inside the `nsfwjs` npm package as
 * JS modules, so nothing is downloaded at runtime.
 *
 * TensorFlow is imported lazily on first classification so merely importing
 * this module (e.g. through the cron graph) costs nothing.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { logger } from "@/lib/logger";
import {
  ClassifierUnavailableError,
  ClassifyInputError,
  NSFW_MODEL_VERSION,
  type NsfwScores,
  type PhotoClassifier,
} from "./classifier";
import { decodeJpegToRgb, type RgbImage } from "./decode";

/** What the classifier needs from a loaded model: one image in, five scores out. */
export interface LoadedNsfwModel {
  predict(image: RgbImage): Promise<NsfwScores>;
}

export type NsfwModelLoader = () => Promise<LoadedNsfwModel>;

const CLASS_KEYS: Record<string, keyof NsfwScores> = {
  Drawing: "drawing",
  Hentai: "hentai",
  Neutral: "neutral",
  Porn: "porn",
  Sexy: "sexy",
};
/** Ask for every class so absent keys never silently read as 0. */
const CLASS_COUNT = Object.keys(CLASS_KEYS).length;

/**
 * Directory holding the `.wasm` binaries. Resolved through Node's module
 * resolution from this file rather than `process.cwd()`, so it finds the
 * package wherever `node_modules` actually is (repo root under Vitest/dev, the
 * standalone dir under `server.js`, where `next.config.ts`'s
 * `outputFileTracingIncludes` copies the binaries).
 *
 * `turbopackIgnore` is load-bearing: without it Turbopack rewrites the
 * `require.resolve` into a bundler module id, `path.dirname` throws, and the
 * loader silently falls back to the ~10x slower cpu backend in production.
 * Verified against a standalone build: this resolves to
 * `.next/standalone/node_modules/@tensorflow/tfjs-backend-wasm/dist/`.
 */
function wasmDirectory(): string {
  const require = createRequire(import.meta.url);
  const entry = require.resolve(/* turbopackIgnore: true */ "@tensorflow/tfjs-backend-wasm");
  return `${path.dirname(entry)}${path.sep}`;
}

async function loadNsfwjsModel(): Promise<LoadedNsfwModel> {
  const tf = await import("@tensorflow/tfjs");
  const { setWasmPaths } = await import("@tensorflow/tfjs-backend-wasm");
  const nsfwjs = await import("nsfwjs");

  let backend = "wasm";
  try {
    // Node has no SharedArrayBuffer-backed worker setup for emscripten pthreads.
    tf.env().set("WASM_HAS_MULTITHREAD_SUPPORT", false);
    setWasmPaths(wasmDirectory());
    if (!(await tf.setBackend("wasm"))) throw new Error("wasm backend failed to initialize");
  } catch (error) {
    logger.warn("[ProtonNsfw] wasm backend unavailable, falling back to cpu", {
      error: error instanceof Error ? error.message : String(error),
    });
    backend = "cpu";
    if (!(await tf.setBackend("cpu"))) throw new Error("cpu backend failed to initialize");
  }
  await tf.ready();
  tf.enableProdMode();

  const model = await nsfwjs.load("MobileNetV2");
  logger.info("[ProtonNsfw] classifier loaded", { backend, modelVersion: NSFW_MODEL_VERSION });

  return {
    async predict({ width, height, data }) {
      const tensor = tf.tensor3d(data, [height, width, 3], "int32");
      try {
        const predictions = await model.classify(tensor, CLASS_COUNT);
        const scores: NsfwScores = { drawing: 0, hentai: 0, neutral: 0, porn: 0, sexy: 0 };
        for (const { className, probability } of predictions) {
          const key = CLASS_KEYS[className];
          if (key) scores[key] = probability;
        }
        return scores;
      } finally {
        tensor.dispose();
      }
    },
  };
}

/**
 * Builds a classifier over `load`, loading lazily on first use. A failed load
 * is not cached: it throws `ClassifierUnavailableError` and the next call tries
 * again. Exported for tests; production code uses `createNsfwjsClassifier`.
 */
export function buildNsfwjsClassifier(load: NsfwModelLoader): PhotoClassifier {
  let model: Promise<LoadedNsfwModel> | null = null;

  function getModel(): Promise<LoadedNsfwModel> {
    if (!model) {
      model = load().catch((cause: unknown) => {
        model = null;
        logger.error("[ProtonNsfw] classifier failed to load", {
          error: cause instanceof Error ? cause.message : String(cause),
        });
        throw new ClassifierUnavailableError("NSFW classifier failed to load", { cause });
      });
    }
    return model;
  }

  return {
    modelVersion: NSFW_MODEL_VERSION,
    async classify(jpeg) {
      // Decode first: a bad image is a per-photo failure even when the model
      // is down, and it never needs the model to be loaded.
      const image = decodeJpegToRgb(jpeg);
      const loaded = await getModel();
      try {
        return await loaded.predict(image);
      } catch (cause) {
        throw new ClassifyInputError("Image could not be classified", { cause });
      }
    },
  };
}

let shared: PhotoClassifier | null = null;

/** One classifier (one model) per process; warm-up and sync share it. */
export function createNsfwjsClassifier(): PhotoClassifier {
  shared ??= buildNsfwjsClassifier(loadNsfwjsModel);
  return shared;
}
