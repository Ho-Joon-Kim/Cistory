/**
 * NSFW screening contract for Proton photo thumbnails.
 *
 * The classifier runs locally (cron process only) so no photo ever leaves the
 * server. The implementation lives in `nsfwjs.ts`; everything that decides
 * what to do with a score depends only on this file.
 */

/** The five NSFWJS class probabilities, each in [0, 1], summing to ~1. */
export interface NsfwScores {
  drawing: number;
  hentai: number;
  neutral: number;
  porn: number;
  sexy: number;
}

export interface PhotoClassifier {
  readonly modelVersion: string;
  /** Classifies one JPEG thumbnail. Never logs or retains the bytes. */
  classify(jpeg: Uint8Array): Promise<NsfwScores>;
}

/**
 * The model or tensor backend could not load — an infrastructure failure, not
 * a property of any one photo. Callers must not burn per-photo attempts on it.
 */
export class ClassifierUnavailableError extends Error {
  constructor(message = "NSFW classifier unavailable", options?: ErrorOptions) {
    super(message, options);
    this.name = "ClassifierUnavailableError";
  }
}

/** Per-image failure: missing, non-JPEG, truncated, or over the decode cap. */
export class ClassifyInputError extends Error {
  constructor(message = "Image could not be classified", options?: ErrorOptions) {
    super(message, options);
    this.name = "ClassifyInputError";
  }
}

/** Recorded with every screening result; bump when the model or package changes. */
export const NSFW_MODEL_VERSION = "nsfwjs@4.4.0/MobileNetV2";

export const NSFW_BLOCK_PORN_PLUS_HENTAI = 0.5;
export const NSFW_BLOCK_SEXY = 0.8;

/**
 * Fail closed: a non-finite score (NaN compares false against any threshold)
 * blocks rather than passing an image without a real verdict.
 */
export function isBlocked(s: NsfwScores): boolean {
  if (!Object.values(s).every(Number.isFinite)) return true;
  return s.porn + s.hentai >= NSFW_BLOCK_PORN_PLUS_HENTAI || s.sexy >= NSFW_BLOCK_SEXY;
}
