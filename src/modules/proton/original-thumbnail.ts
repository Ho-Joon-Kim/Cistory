/**
 * Builds a thumbnail from a photo's original when Proton has none (or only an
 * undecodable one). The result is a plain JPEG that then goes through the
 * exact NSFW screening every Proton thumbnail does; it is stored only on a
 * pass, so this module never decides what is exposed.
 *
 * JPEG, PNG, WebP and still AVIF decode through sharp. HEIC/HEIF (HEVC) does
 * not: sharp's prebuilt libvips ships without an HEVC decoder, so those go
 * through `heic-decode` (libheif compiled to wasm; runs on Alpine/musl since
 * it has no native binary). Both are loaded lazily, cron-side only.
 *
 * Fail-closed: animations, unknown formats, oversized or corrupt images throw
 * `OriginalUndecodableError`. A decoder that cannot load at all throws
 * `ClassifierUnavailableError` (an infrastructure fault that must not burn
 * per-photo attempts). Error messages never carry image bytes.
 */
import { ClassifierUnavailableError } from "./nsfw/classifier";
import { sniffThumbnailFormat } from "./thumbnail-format";

/** Long edge of a generated thumbnail; Proton's Type1 thumbnails are at most 512 px. */
export const GENERATED_THUMBNAIL_EDGE = 512;
/** Above a 48 MP phone JPEG; sharp shrinks JPEGs on load, so these stay cheap. Bigger is refused. */
export const ORIGINAL_MAX_PIXELS = 50_000_000;
/**
 * libheif decodes the full frame into its wasm heap, which never shrinks
 * again; 16.8 MP (4096 x 4096) covers the 12 MP HEICs phones write.
 */
export const HEIC_MAX_PIXELS = 4096 * 4096;

export class OriginalUndecodableError extends Error {
  constructor(message = "Original could not be turned into a thumbnail", options?: ErrorOptions) {
    super(message, options);
    this.name = "OriginalUndecodableError";
  }
}

type Sharp = typeof import("sharp").default;
type HeicDecodeAll = (input: { buffer: Uint8Array }) => Promise<
  Array<{
    width: number;
    height: number;
    decode(): Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
  }> & { dispose(): void }
>;

let sharpModule: Promise<Sharp> | null = null;
let heicModule: Promise<HeicDecodeAll> | null = null;

async function loadOnce<T>(
  get: () => Promise<T> | null,
  set: (p: Promise<T> | null) => void,
  load: () => Promise<T>,
  what: string
): Promise<T> {
  let pending = get();
  if (!pending) {
    pending = load();
    set(pending);
  }
  try {
    return await pending;
  } catch (cause) {
    set(null);
    throw new ClassifierUnavailableError(`${what} failed to load`, { cause });
  }
}

function loadSharp(): Promise<Sharp> {
  return loadOnce(
    () => sharpModule,
    (p) => {
      sharpModule = p;
    },
    () => import("sharp").then((m) => m.default),
    "Image decoder (sharp)"
  );
}

/** Loads libheif's wasm build; exported so cron warm-up can prove it loads in the image. */
export function loadHeicDecoder(): Promise<HeicDecodeAll> {
  return loadOnce(
    () => heicModule,
    (p) => {
      heicModule = p;
    },
    async () => {
      const mod = (await import("heic-decode")) as unknown as {
        default?: { all: HeicDecodeAll };
        all?: HeicDecodeAll;
      };
      const all = mod.all ?? mod.default?.all;
      if (typeof all !== "function") throw new Error("heic-decode has no all()");
      return all;
    },
    "HEIF decoder (libheif-js)"
  );
}

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

/** Still HEIC/HEIF (HEVC) by its `ftyp` brand. Sequences (bursts, animations) are not still images. */
export function isStillHeic(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || ascii(bytes, 4, 8) !== "ftyp") return false;
  const major = ascii(bytes, 8, 12);
  if (major === "heic" || major === "heix") return true;
  if (major !== "mif1") return false;
  const boxSize = Math.min(
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0),
    bytes.length
  );
  const brands: string[] = [];
  for (let offset = 16; offset + 4 <= boxSize; offset += 4)
    brands.push(ascii(bytes, offset, offset + 4));
  return (brands.includes("heic") || brands.includes("heix")) && !brands.includes("msf1");
}

const JPEG_OPTIONS = { quality: 82, mozjpeg: true } as const;

function resizeToJpeg(image: import("sharp").Sharp): Promise<Buffer> {
  return image
    .resize(GENERATED_THUMBNAIL_EDGE, GENERATED_THUMBNAIL_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .jpeg(JPEG_OPTIONS)
    .toBuffer();
}

async function fromSharpFormat(bytes: Uint8Array, format: string): Promise<Buffer> {
  const sharp = await loadSharp();
  const options = { limitInputPixels: ORIGINAL_MAX_PIXELS, failOn: "error" } as const;
  const metadata = await sharp(bytes, options).metadata();
  const decoded =
    metadata.format === "heif" && metadata.compression === "av1" ? "avif" : metadata.format;
  if (decoded !== format) throw new OriginalUndecodableError("Format does not match its signature");
  if ((metadata.pages ?? 1) > 1)
    throw new OriginalUndecodableError("Animated images are not supported");
  // `.rotate()` applies the EXIF orientation, so the thumbnail shows what a viewer sees.
  return resizeToJpeg(sharp(bytes, options).rotate());
}

async function fromHeic(bytes: Uint8Array): Promise<Buffer> {
  const decodeAll = await loadHeicDecoder();
  const sharp = await loadSharp();
  const images = await decodeAll({ buffer: bytes });
  try {
    const primary = images[0];
    if (!primary) throw new OriginalUndecodableError("HEIF image not found");
    if (
      !(primary.width > 0 && primary.height > 0) ||
      primary.width * primary.height > HEIC_MAX_PIXELS
    ) {
      throw new OriginalUndecodableError("HEIF image is empty or over the pixel cap");
    }
    // libheif applies the file's rotation/mirror transforms while decoding.
    const { width, height, data } = await primary.decode();
    if (data.length !== width * height * 4) {
      throw new OriginalUndecodableError("HEIF decoded to a malformed bitmap");
    }
    return await resizeToJpeg(
      sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
        raw: { width, height, channels: 4 },
      })
    );
  } finally {
    images.dispose();
  }
}

/**
 * A JPEG thumbnail (long edge ≤ `GENERATED_THUMBNAIL_EDGE`, no metadata — the
 * original's EXIF GPS never rides along) generated from an original's bytes.
 */
export async function thumbnailFromOriginal(bytes: Uint8Array): Promise<Uint8Array> {
  const format = sniffThumbnailFormat(bytes);
  const heic = !format && isStillHeic(bytes);
  if (!format && !heic) throw new OriginalUndecodableError("Unsupported original format");
  try {
    const out = format ? await fromSharpFormat(bytes, format) : await fromHeic(bytes);
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  } catch (error) {
    if (error instanceof OriginalUndecodableError) throw error;
    if (error instanceof ClassifierUnavailableError) throw error;
    throw new OriginalUndecodableError(undefined, { cause: error });
  }
}
