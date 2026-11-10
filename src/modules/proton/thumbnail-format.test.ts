import { describe, expect, it } from "vitest";
import { sniffThumbnailFormat } from "./thumbnail-format";

const latin1 = (s: string) => new Uint8Array(Buffer.from(s, "latin1"));

describe("sniffThumbnailFormat", () => {
  it.each([
    ["JFIF JPEG", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), "jpeg"],
    ["extended WebP", latin1("RIFF\x10\0\0\0WEBPVP8X"), "webp"],
    ["lossless WebP", latin1("RIFF\x10\0\0\0WEBPVP8L"), "webp"],
    ["PNG", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "png"],
    ["AVIF (major brand avif)", latin1("\0\0\0\x1cftypavif\0\0\0\0mif1avifmiaf"), "avif"],
    ["AVIF (major mif1, compatible avif)", latin1("\0\0\0\x18ftypmif1\0\0\0\0mif1avif"), "avif"],
    ["AVIF sequence (avis)", latin1("\0\0\0\x18ftypavis\0\0\0\0avismsf1"), null],
    ["mif1 listing avis too", latin1("\0\0\0\x1cftypmif1\0\0\0\0mif1avifavis"), null],
    ["HEIC", latin1("\0\0\0\x18ftypheic\0\0\0\0mif1heic"), null],
    ["GIF", latin1("GIF89a"), null],
    ["RIFF WAVE", latin1("RIFF\0\0\0\0WAVEfmt "), null],
    ["a bare RIFF header", latin1("RIFF\0\0\0\0WEB"), null],
    ["empty", new Uint8Array(0), null],
  ])("%s → %s", (_name, bytes, expected) => {
    expect(sniffThumbnailFormat(bytes)).toBe(expected);
  });
});
