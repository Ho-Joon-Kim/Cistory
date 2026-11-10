/**
 * Magic-byte sniffing for Proton photo thumbnails.
 *
 * Proton's Type1 thumbnails arrive as JPEG (JFIF) or WebP (including the
 * extended `VP8X` container); PNG and still AVIF are accepted too. The NSFW
 * decoder accepts exactly this allowlist and the thumbnail route serves the
 * stored bytes with the matching type, so screening and serving always agree
 * on what the bytes are. Dependency-free: the web route imports it without
 * pulling in the classifier.
 */

export type ThumbnailFormat = "jpeg" | "webp" | "png" | "avif";

export const THUMBNAIL_CONTENT_TYPES: Record<ThumbnailFormat, string> = {
  jpeg: "image/jpeg",
  webp: "image/webp",
  png: "image/png",
  avif: "image/avif",
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + prefix.length) return false;
  return prefix.every((b, i) => bytes[offset + i] === b);
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/**
 * A still AVIF: an ISO-BMFF `ftyp` box whose major brand is `avif`, or whose
 * compatible brands list `avif` (e.g. major `mif1`). `avis` (an image sequence,
 * i.e. animated) and HEIC brands are not on the allowlist.
 */
function isStillAvif(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, ascii("ftyp"), 4)) return false;
  const brandAt = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  const major = brandAt(8);
  if (major === "avif") return true;
  if (major !== "mif1") return false;
  const boxSize = Math.min(
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0),
    bytes.length
  );
  const brands: string[] = [];
  // ftyp: size(4) 'ftyp'(4) major(4) minor_version(4) compatible brands(4 each).
  for (let offset = 16; offset + 4 <= boxSize; offset += 4) brands.push(brandAt(offset));
  return brands.includes("avif") && !brands.includes("avis");
}

/** The allowlisted format the bytes claim to be, or null for anything else. */
export function sniffThumbnailFormat(bytes: Uint8Array): ThumbnailFormat | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, PNG_SIGNATURE)) return "png";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "webp";
  if (isStillAvif(bytes)) return "avif";
  return null;
}
