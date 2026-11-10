import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { EMPTY_EXIF, mapExif, parseUtcOffset, readOriginalExif } from "./original-exif";
import type { ByteSource } from "./original-source";
import { withExif } from "./testing/exif-fixture";

/**
 * `galaxy-like.heic` is a 640x480 HEVC still made by libheif's `heif-enc` from
 * a generated JPEG carrying synthetic EXIF (samsung SM-S908N, 37.123456 N
 * 122.5 W, heading 123.45 T, +09:00). Its `iloc` base offsets were folded
 * into the extent offsets, the layout Samsung and Apple write. HEIC cannot be
 * encoded at test time (no HEVC encoder in sharp's prebuilt libvips), so this
 * one file is committed; it is the Exif item at the very END of the file that
 * the ranged-read assertions rely on.
 */
const HEIC = new Uint8Array(readFileSync(new URL("./testing/galaxy-like.heic", import.meta.url)));

async function noiseJpeg(width = 640, height = 480): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
        noise: { type: "gaussian", mean: 128, sigma: 50 },
      },
    })
      .jpeg({ quality: 95 })
      .toBuffer()
  );
}

/** Serves `bytes` and records every range requested. */
function countingSource(bytes: Uint8Array) {
  const reads: [number, number][] = [];
  let bytesRead = 0;
  const source: ByteSource = {
    size: bytes.length,
    get bytesRead() {
      return bytesRead;
    },
    async read(offset, length) {
      reads.push([offset, length]);
      const out = bytes.subarray(offset, Math.min(bytes.length, offset + length));
      bytesRead += out.length;
      return out;
    },
  };
  return { source, reads, read: () => bytesRead };
}

describe("parseUtcOffset", () => {
  it.each([
    ["+09:00", 540],
    ["-03:30", -210],
    ["+00:00", 0],
    [" +05:45 ", 345],
    ["+14:00", 840],
  ])("parses %s", (value, minutes) => {
    expect(parseUtcOffset(value)).toBe(minutes);
  });

  it.each(["", "09:00", "+9:00", "+09:60", "+15:00", "Z", "+0900", 540, null])(
    "rejects %s",
    (value) => {
      expect(parseUtcOffset(value)).toBeNull();
    }
  );
});

describe("mapExif", () => {
  it("keeps valid GPS, heading with reference, and offset", () => {
    expect(
      mapExif({
        latitude: 37.5,
        longitude: 127.25,
        GPSImgDirection: 271.5,
        GPSImgDirectionRef: "M",
        OffsetTimeOriginal: "+09:00",
      })
    ).toEqual({ lat: 37.5, lon: 127.25, direction: 271.5, directionRef: "M", utcOffsetMin: 540 });
  });

  it("rejects the (0,0) sentinel and out-of-range values", () => {
    expect(mapExif({ latitude: 0, longitude: 0 })).toEqual(EMPTY_EXIF);
    expect(mapExif({ latitude: 91, longitude: 10 })).toEqual(EMPTY_EXIF);
    expect(mapExif({ GPSImgDirection: 361, GPSImgDirectionRef: "T" })).toEqual(EMPTY_EXIF);
    expect(mapExif({ GPSImgDirection: Number.NaN })).toEqual(EMPTY_EXIF);
  });

  it("normalises 360 to 0 and drops an unknown reference but keeps the heading", () => {
    expect(mapExif({ GPSImgDirection: 360, GPSImgDirectionRef: "T" })).toMatchObject({
      direction: 0,
      directionRef: "T",
    });
    expect(mapExif({ GPSImgDirection: 10, GPSImgDirectionRef: "X" })).toMatchObject({
      direction: 10,
      directionRef: null,
    });
  });

  it("falls back to OffsetTimeDigitized, never to OffsetTime (an edit's offset)", () => {
    expect(mapExif({ OffsetTimeDigitized: "-05:00" }).utcOffsetMin).toBe(-300);
    expect(mapExif({ OffsetTime: "+01:00" }).utcOffsetMin).toBeNull();
  });

  it("is empty for nothing", () => {
    expect(mapExif(undefined)).toEqual(EMPTY_EXIF);
    expect(mapExif("x")).toEqual(EMPTY_EXIF);
  });
});

describe("readOriginalExif", () => {
  it("reads an iPhone-style JPEG's GPS, heading and offset from its first chunk only", async () => {
    const jpeg = withExif(await noiseJpeg(), {
      make: "Apple",
      model: "iPhone 14 Pro",
      lat: -33.8568,
      lon: 151.2153,
      direction: 87.25,
      directionRef: "T",
      offsetTimeOriginal: "+10:00",
    });
    expect(jpeg.length).toBeGreaterThan(150_000);
    const { source, read } = countingSource(jpeg);

    const exif = await readOriginalExif(source);

    expect(exif.lat).toBeCloseTo(-33.8568, 5);
    expect(exif.lon).toBeCloseTo(151.2153, 5);
    expect(exif).toMatchObject({ direction: 87.25, directionRef: "T", utcOffsetMin: 540 + 60 });
    expect(read()).toBeLessThanOrEqual(64 * 1024);
  });

  it("reads a Galaxy-style JPEG without a heading", async () => {
    const jpeg = withExif(await noiseJpeg(64, 48), {
      make: "samsung",
      model: "SM-S908N",
      lat: 35.1,
      lon: 129.04,
      offsetTimeOriginal: "+09:00",
    });
    const exif = await readOriginalExif(countingSource(jpeg).source);
    expect(exif).toMatchObject({ direction: null, directionRef: null, utcOffsetMin: 540 });
    expect(exif.lat).toBeCloseTo(35.1, 5);
  });

  it("reads a HEIC whose Exif item sits at the end, skipping the image data between", async () => {
    const { source, reads, read } = countingSource(HEIC);

    const exif = await readOriginalExif(source);

    expect(exif.lat).toBeCloseTo(37.123456, 5);
    expect(exif.lon).toBeCloseTo(-122.5, 5);
    expect(exif).toMatchObject({ direction: 123.45, directionRef: "T", utcOffsetMin: 540 });
    // The head (ftyp + meta) and the tail (Exif item); not the HEVC data.
    expect(reads[0][0]).toBe(0);
    expect(reads.some(([offset]) => offset > HEIC.length - 1024)).toBe(true);
    expect(read()).toBeLessThan(HEIC.length * 0.6);
  });

  it("returns empty EXIF for a JPEG without any, a non-image, and garbage", async () => {
    expect(await readOriginalExif(countingSource(await noiseJpeg(16, 16)).source)).toEqual(
      EMPTY_EXIF
    );
    const mp4 = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from("ftypisom"), 0, 0, 0, 0]);
    expect(await readOriginalExif(countingSource(mp4).source)).toEqual(EMPTY_EXIF);
    expect(await readOriginalExif(countingSource(new Uint8Array(0)).source)).toEqual(EMPTY_EXIF);
    expect(await readOriginalExif(countingSource(new Uint8Array(4096).fill(7)).source)).toEqual(
      EMPTY_EXIF
    );
  });

  it("throws when the source itself fails, rather than reporting no EXIF", async () => {
    const failing: ByteSource = {
      size: 1_000_000,
      bytesRead: 0,
      read: async () => {
        throw new Error("network");
      },
    };
    await expect(readOriginalExif(failing)).rejects.toThrow("network");
  });

  it("throws when a later ranged read fails mid-parse", async () => {
    let calls = 0;
    const flaky: ByteSource = {
      size: HEIC.length,
      bytesRead: 0,
      async read(offset, length) {
        calls += 1;
        if (calls > 1) throw new Error("block fetch failed");
        return HEIC.subarray(offset, offset + length);
      },
    };
    await expect(readOriginalExif(flaky)).rejects.toThrow("block fetch failed");
  });
});
