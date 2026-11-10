import { sniffThumbnailFormat } from "../thumbnail-format";
import { ClassifierUnavailableError, ClassifyInputError } from "./classifier";

/** Decode cap: Proton thumbnails are far smaller; anything bigger is refused. */
export const MAX_INPUT_PIXELS = 4_000_000;

export interface RgbImage {
  width: number;
  height: number;
  /** Row-major RGB, 3 bytes per pixel, no alpha. */
  data: Uint8Array;
}

type Sharp = typeof import("sharp").default;

let sharpModule: Promise<Sharp> | null = null;

/**
 * Loads sharp's native binding lazily, so importing this module (through the
 * cron graph) costs nothing. A binding that fails to load is an infrastructure
 * fault, never a property of one photo, so it must not burn per-photo attempts.
 */
async function loadSharp(): Promise<Sharp> {
  sharpModule ??= import("sharp").then((m) => m.default);
  try {
    return await sharpModule;
  } catch (cause) {
    sharpModule = null;
    throw new ClassifierUnavailableError("Image decoder (sharp) failed to load", { cause });
  }
}

/** True when a PNG carries an `acTL` chunk before its image data (an APNG). */
function isAnimatedPng(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "acTL") return true;
    if (type === "IDAT" || type === "IEND") return false;
    offset += 12 + view.getUint32(offset);
  }
  return false;
}

/**
 * Decodes a JPEG, WebP (simple or extended `VP8X`, with or without alpha), PNG
 * or still AVIF thumbnail to 3-channel sRGB. Fail-closed: any other format, an animation
 * (only its first frame could be screened, yet a browser would play them all),
 * a truncated or corrupt image, or one over the pixel cap throws
 * `ClassifyInputError`. Error messages never include image bytes; sharp's own
 * message is kept only as `cause`.
 *
 * Alpha is flattened onto white rather than dropped: screening must see what a
 * viewer is shown, not the colour channels hidden under transparent pixels.
 */
export async function decodeToRgb(bytes: Uint8Array): Promise<RgbImage> {
  const format = sniffThumbnailFormat(bytes);
  if (!format) throw new ClassifyInputError("Unsupported image format");
  if (format === "png" && isAnimatedPng(bytes)) {
    throw new ClassifyInputError("Animated images are not supported");
  }

  const sharp = await loadSharp();
  const options = { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" } as const;
  let result: { data: Buffer; info: { width: number; height: number; channels: number } };
  try {
    const metadata = await sharp(bytes, options).metadata();
    // The decoder's own view must match the magic bytes; no format sneaks past.
    // libvips reports AVIF as `heif` with AV1 compression (HEVC/HEIC never passes).
    const decoded =
      metadata.format === "heif" && metadata.compression === "av1" ? "avif" : metadata.format;
    if (decoded !== format) {
      throw new ClassifyInputError("Image format does not match its signature");
    }
    if ((metadata.pages ?? 1) > 1) {
      throw new ClassifyInputError("Animated images are not supported");
    }
    result = await sharp(bytes, options)
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb")
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (cause) {
    if (cause instanceof ClassifyInputError) throw cause;
    throw new ClassifyInputError("Image could not be decoded", { cause });
  }

  const { data, info } = result;
  const { width, height } = info;
  if (!(width > 0 && height > 0) || info.channels !== 3 || data.length !== width * height * 3) {
    throw new ClassifyInputError("Image decoded to an empty or malformed bitmap");
  }
  return { width, height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}
