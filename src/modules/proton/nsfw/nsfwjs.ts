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
import { decodeToRgb, type RgbImage } from "./decode";

/** One raw model output row, exactly as nsfwjs reports it. */
export interface NsfwPrediction {
  className: string;
  probability: number;
}

/** What the classifier needs from a loaded model: one image in, raw class rows out. */
export interface LoadedNsfwModel {
  /** Active tensor backend (`wasm`, or `cpu` after a fallback). */
  readonly backend: string;
  predict(image: RgbImage): Promise<NsfwPrediction[]>;
  /** Releases the model's tensors; best effort. */
  dispose?(): void;
}

/** A `PhotoClassifier` that also reports the backend it loaded on. */
export interface NsfwjsClassifier extends PhotoClassifier {
  /** `null` until the model has loaded. Cron logs a `cpu` fallback from this. */
  readonly backend: string | null;
  /** Loads the model now (cron warm-up) and resolves to its backend. */
  load(): Promise<string>;
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
/** Softmax outputs sum to 1; anything further off is a broken runtime. */
const SUM_TOLERANCE = 0.02;

/** A fixed 8×8 mid-gray image: any working runtime classifies it. */
const CANARY: RgbImage = { width: 8, height: 8, data: new Uint8Array(8 * 8 * 3).fill(128) };

/**
 * Maps raw rows to scores, or returns null when the output is malformed: a
 * missing, duplicate or unknown class, or a probability that is non-finite,
 * outside [0, 1], or a total off 1. Malformed output must never read as "pass".
 */
function toScores(predictions: NsfwPrediction[]): NsfwScores | null {
  if (!Array.isArray(predictions) || predictions.length !== CLASS_COUNT) return null;
  const scores: Partial<NsfwScores> = {};
  let sum = 0;
  for (const { className, probability } of predictions) {
    const key = Object.hasOwn(CLASS_KEYS, className) ? CLASS_KEYS[className] : undefined;
    if (!key || key in scores) return null;
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) return null;
    scores[key] = probability;
    sum += probability;
  }
  if (Math.abs(sum - 1) > SUM_TOLERANCE) return null;
  return scores as NsfwScores;
}

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
    backend,
    async predict({ width, height, data }) {
      const tensor = tf.tensor3d(data, [height, width, 3], "int32");
      try {
        return await model.classify(tensor, CLASS_COUNT);
      } finally {
        tensor.dispose();
      }
    },
    dispose() {
      model.dispose();
    },
  };
}

/**
 * Builds a classifier over `load`, loading lazily on first use. A failed load
 * is not cached: it throws `ClassifierUnavailableError` and the next call tries
 * again. Exported for tests; production code uses `createNsfwjsClassifier`.
 *
 * Failure split (Review Focus 1 — an infrastructure fault must never burn
 * per-photo attempts across the library):
 * - undecodable bytes → `ClassifyInputError`, without touching the model
 *   (a decoder, i.e. sharp, that fails to load is `ClassifierUnavailableError`);
 * - load failure or malformed model output → `ClassifierUnavailableError`;
 * - `predict` throwing on an already-validated image → drop the model, reload,
 *   and classify a fixed canary. If the canary fails too the runtime is broken
 *   (wasm OOM, emscripten abort, lost backend): `ClassifierUnavailableError`.
 *   If the canary passes, the image itself is at fault: `ClassifyInputError`.
 */
export function buildNsfwjsClassifier(load: NsfwModelLoader): NsfwjsClassifier {
  let model: Promise<LoadedNsfwModel> | null = null;
  // The resolved model behind `model`, so a stale caller can't drop a newer one.
  let current: LoadedNsfwModel | null = null;

  function getModel(): Promise<LoadedNsfwModel> {
    if (!model) {
      // Promise.resolve().then: a loader that throws synchronously still lands
      // in the rejection branch below.
      const loading = Promise.resolve()
        .then(load)
        .then(
          (loaded) => {
            if (model === loading) current = loaded;
            return loaded;
          },
          (cause: unknown) => {
            if (model === loading) model = null;
            logger.error("[ProtonNsfw] classifier failed to load", { error: errorMessage(cause) });
            throw new ClassifierUnavailableError("NSFW classifier failed to load", { cause });
          }
        );
      model = loading;
    }
    return model;
  }

  function dropModel(loaded: LoadedNsfwModel): void {
    if (current !== loaded) return;
    current = null;
    model = null;
    try {
      loaded.dispose?.();
    } catch {
      // The runtime is already suspect; a failed dispose changes nothing.
    }
  }

  function scoresOrUnavailable(loaded: LoadedNsfwModel, rows: NsfwPrediction[]): NsfwScores {
    const scores = toScores(rows);
    if (scores) return scores;
    dropModel(loaded);
    logger.error("[ProtonNsfw] classifier returned malformed scores");
    throw new ClassifierUnavailableError("NSFW classifier returned malformed scores");
  }

  /** Throws `ClassifierUnavailableError` unless a freshly loaded model classifies the canary. */
  async function assertRuntimeHealthy(): Promise<void> {
    const fresh = await getModel();
    let rows: NsfwPrediction[];
    try {
      rows = await fresh.predict(CANARY);
    } catch (cause) {
      dropModel(fresh);
      logger.error("[ProtonNsfw] canary classification failed", { error: errorMessage(cause) });
      throw new ClassifierUnavailableError("NSFW classifier runtime failed", { cause });
    }
    scoresOrUnavailable(fresh, rows);
  }

  return {
    modelVersion: NSFW_MODEL_VERSION,
    get backend() {
      return current?.backend ?? null;
    },
    async load() {
      return (await getModel()).backend;
    },
    async classify(thumbnail) {
      // Decode first: a bad image is a per-photo failure even when the model
      // is down, and it never needs the model to be loaded.
      const image = await decodeToRgb(thumbnail);
      const loaded = await getModel();
      let rows: NsfwPrediction[];
      try {
        rows = await loaded.predict(image);
      } catch (cause) {
        dropModel(loaded);
        await assertRuntimeHealthy();
        throw new ClassifyInputError("Image could not be classified", { cause });
      }
      return scoresOrUnavailable(loaded, rows);
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let shared: NsfwjsClassifier | null = null;

/** One classifier (one model) per process; warm-up and sync share it. */
export function createNsfwjsClassifier(): NsfwjsClassifier {
  shared ??= buildNsfwjsClassifier(loadNsfwjsModel);
  return shared;
}
