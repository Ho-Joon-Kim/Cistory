import { decode } from "jpeg-js";
import { ClassifyInputError } from "./classifier";

/** Decode cap: Proton thumbnails are far smaller; anything bigger is refused. */
const MAX_RESOLUTION_MP = 4;
const MAX_MEMORY_MB = 128;

export interface RgbImage {
  width: number;
  height: number;
  /** Row-major RGB, 3 bytes per pixel, no alpha. */
  data: Uint8Array;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Decodes a JPEG to 3-channel RGB. Anything that is not a decodable JPEG within
 * the cap throws `ClassifyInputError`. The underlying decoder message is kept
 * as `cause` but never includes image bytes.
 */
export function decodeJpegToRgb(bytes: Uint8Array): RgbImage {
  if (!isJpeg(bytes)) throw new ClassifyInputError("Not a JPEG image");
  let image: { width: number; height: number; data: Uint8Array };
  try {
    image = decode(bytes, {
      useTArray: true,
      formatAsRGBA: false,
      maxResolutionInMP: MAX_RESOLUTION_MP,
      maxMemoryUsageInMB: MAX_MEMORY_MB,
    });
  } catch (cause) {
    throw new ClassifyInputError("JPEG could not be decoded", { cause });
  }
  const { width, height, data } = image;
  if (!(width > 0 && height > 0) || data.length !== width * height * 3) {
    throw new ClassifyInputError("JPEG decoded to an empty or malformed image");
  }
  return { width, height, data };
}
