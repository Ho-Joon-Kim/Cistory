import { readFileSync } from "node:fs";
import exifr from "exifr";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { decodeToRgb } from "./nsfw/decode";
import {
  GENERATED_THUMBNAIL_EDGE,
  isStillHeic,
  OriginalUndecodableError,
  thumbnailFromOriginal,
} from "./original-thumbnail";
import { withExif } from "./testing/exif-fixture";
import { sniffThumbnailFormat } from "./thumbnail-format";

// See original-exif.test.ts for how this committed fixture was made.
const HEIC = new Uint8Array(readFileSync(new URL("./testing/galaxy-like.heic", import.meta.url)));

const RED = { r: 200, g: 20, b: 20 };

async function encoded(
  width: number,
  height: number,
  format: "jpeg" | "png" | "webp",
  alpha?: number
): Promise<Uint8Array> {
  const img = sharp({
    create: {
      width,
      height,
      channels: alpha === undefined ? 3 : 4,
      background: alpha === undefined ? RED : { ...RED, alpha },
    },
  });
  return new Uint8Array(await img[format]().toBuffer());
}

async function dims(bytes: Uint8Array) {
  const m = await sharp(bytes).metadata();
  return [m.width, m.height];
}

describe("isStillHeic", () => {
  it("recognises the fixture and rejects sequences, AVIF and JPEG", () => {
    expect(isStillHeic(HEIC)).toBe(true);
    const ftyp = (major: string, ...compat: string[]) => {
      const brands = [major, "\0\0\0\0", ...compat].join("");
      const size = 8 + brands.length;
      return new Uint8Array([0, 0, 0, size, ...Buffer.from(`ftyp${brands}`, "latin1")]);
    };
    expect(isStillHeic(ftyp("mif1", "heic"))).toBe(true);
    expect(isStillHeic(ftyp("msf1", "hevc"))).toBe(false);
    expect(isStillHeic(ftyp("mif1", "heic", "msf1"))).toBe(false);
    expect(isStillHeic(ftyp("hevc"))).toBe(false);
    expect(isStillHeic(ftyp("avif", "mif1"))).toBe(false);
    expect(isStillHeic(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false);
  });
});

describe("thumbnailFromOriginal", () => {
  it("turns a HEIC original into a JPEG the NSFW decoder accepts", async () => {
    const thumb = await thumbnailFromOriginal(HEIC);
    expect(sniffThumbnailFormat(thumb)).toBe("jpeg");
    expect(await dims(thumb)).toEqual([512, 384]);
    const rgb = await decodeToRgb(thumb);
    expect(rgb.data.length).toBe(512 * 384 * 3);
  });

  it("never carries the original's EXIF (GPS) into the thumbnail", async () => {
    const original = withExif(await encoded(1200, 800, "jpeg"), { lat: 37.5, lon: 127.0 });
    expect((await exifr.gps(original))?.latitude).toBeCloseTo(37.5, 5);
    for (const thumb of [
      await thumbnailFromOriginal(original),
      await thumbnailFromOriginal(HEIC),
    ]) {
      expect(await exifr.parse(thumb, { gps: true })).toBeUndefined();
      expect((await sharp(thumb).metadata()).exif).toBeUndefined();
    }
  });

  it.each(["jpeg", "png", "webp"] as const)(
    "shrinks a large %s to the thumbnail edge",
    async (f) => {
      const thumb = await thumbnailFromOriginal(await encoded(2000, 1000, f));
      expect(sniffThumbnailFormat(thumb)).toBe("jpeg");
      expect(await dims(thumb)).toEqual([GENERATED_THUMBNAIL_EDGE, 256]);
    }
  );

  it("never enlarges a small original", async () => {
    expect(await dims(await thumbnailFromOriginal(await encoded(40, 30, "png")))).toEqual([40, 30]);
  });

  it("flattens transparency onto white", async () => {
    const thumb = await thumbnailFromOriginal(await encoded(10, 10, "png", 0));
    const { data } = await decodeToRgb(thumb);
    expect(Math.min(data[0], data[1], data[2])).toBeGreaterThan(245);
  });

  it("applies the EXIF orientation of a JPEG", async () => {
    const rotated = new Uint8Array(
      await sharp({ create: { width: 400, height: 200, channels: 3, background: RED } })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer()
    );
    expect(await dims(await thumbnailFromOriginal(rotated))).toEqual([200, 400]);
  });

  it("fails closed on unknown formats, animations, truncation and HEIC sequences", async () => {
    const fails = (bytes: Uint8Array) =>
      expect(thumbnailFromOriginal(bytes)).rejects.toBeInstanceOf(OriginalUndecodableError);
    await fails(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    await fails(new Uint8Array(0));
    const jpeg = await encoded(300, 300, "jpeg");
    await fails(jpeg.subarray(0, 200));
    await fails(HEIC.subarray(0, 4000));
    const frames = await Promise.all(
      [RED, { r: 0, g: 0, b: 200 }].map((background) =>
        sharp({ create: { width: 8, height: 8, channels: 3, background } })
          .png()
          .toBuffer()
      )
    );
    const animated = new Uint8Array(
      await sharp(frames, { join: { animated: true } })
        .webp()
        .toBuffer()
    );
    expect((await sharp(animated).metadata()).pages).toBe(2);
    await fails(animated);
    const gif = new Uint8Array(
      await sharp({ create: { width: 8, height: 8, channels: 3, background: RED } })
        .gif()
        .toBuffer()
    );
    await fails(gif);
  });
});
