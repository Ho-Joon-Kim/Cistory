import { crc32 } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ClassifyInputError } from "./classifier";
import { decodeToRgb } from "./decode";

const RGB = { r: 128, g: 64, b: 32 };

/** A flat-colour image encoded by sharp (fixtures are generated, never committed). */
function flat(width: number, height: number, alpha?: number) {
  const channels = alpha === undefined ? 3 : 4;
  const background = alpha === undefined ? RGB : { ...RGB, alpha };
  return sharp({ create: { width, height, channels, background } });
}

const bytes = async (img: sharp.Sharp) => new Uint8Array(await img.toBuffer());

const ascii = (buf: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...buf.subarray(from, to));

function expectNear(data: Uint8Array, rgb: [number, number, number], tolerance = 6) {
  expect(Math.abs(data[0] - rgb[0])).toBeLessThan(tolerance);
  expect(Math.abs(data[1] - rgb[1])).toBeLessThan(tolerance);
  expect(Math.abs(data[2] - rgb[2])).toBeLessThan(tolerance);
}

describe("decodeToRgb", () => {
  it("decodes a JPEG to RGB without alpha", async () => {
    const { width, height, data } = await decodeToRgb(await bytes(flat(8, 6).jpeg()));
    expect([width, height, data.length]).toEqual([8, 6, 8 * 6 * 3]);
    expect(data).toBeInstanceOf(Uint8Array);
    expectNear(data, [128, 64, 32]);
  });

  it("decodes a simple (lossy VP8) WebP", async () => {
    const webp = await bytes(flat(10, 7).webp({ quality: 90 }));
    expect(ascii(webp, 12, 16)).toBe("VP8 ");
    const { width, height, data } = await decodeToRgb(webp);
    expect([width, height, data.length]).toEqual([10, 7, 10 * 7 * 3]);
    expectNear(data, [128, 64, 32]);
  });

  it("decodes an extended (VP8X) WebP with alpha, flattening onto white", async () => {
    // The shape Proton's failing Type1 thumbnails have: RIFF....WEBPVP8X.
    const webp = await bytes(flat(12, 9, 0.5).webp({ quality: 90, alphaQuality: 100 }));
    expect(ascii(webp, 0, 4)).toBe("RIFF");
    expect(ascii(webp, 8, 16)).toBe("WEBPVP8X");
    const { width, height, data } = await decodeToRgb(webp);
    expect([width, height, data.length]).toEqual([12, 9, 12 * 9 * 3]);
    // 50% of (128, 64, 32) over white.
    expectNear(data, [191, 159, 143], 8);
  });

  it("decodes a lossless VP8X WebP with alpha", async () => {
    const webp = await bytes(flat(5, 5, 1).webp({ lossless: true }));
    const { data } = await decodeToRgb(webp);
    expect(data.length).toBe(5 * 5 * 3);
    expectNear(data, [128, 64, 32], 2);
  });

  it("decodes a PNG with alpha to 3 channels", async () => {
    const { width, height, data } = await decodeToRgb(await bytes(flat(4, 3, 1).png()));
    expect([width, height, data.length]).toEqual([4, 3, 4 * 3 * 3]);
    expectNear(data, [128, 64, 32], 1);
  });

  it("decodes a still AVIF with alpha, flattening onto white", async () => {
    const avif = await bytes(flat(16, 12, 0.5).avif({ quality: 90 }));
    expect(ascii(avif, 4, 12)).toBe("ftypavif");
    const { width, height, data } = await decodeToRgb(avif);
    expect([width, height, data.length]).toEqual([16, 12, 16 * 12 * 3]);
    expectNear(data, [191, 159, 143], 10);
  });

  it("rejects an AVIF over the 4-megapixel decode cap", async () => {
    const avif = await bytes(flat(2100, 2000).avif({ quality: 30, effort: 0 }));
    await expect(decodeToRgb(avif)).rejects.toBeInstanceOf(ClassifyInputError);
  });

  it("expands a greyscale JPEG to 3 channels", async () => {
    const grey = await bytes(flat(6, 6).greyscale().jpeg());
    const { data } = await decodeToRgb(grey);
    expect(data.length).toBe(6 * 6 * 3);
    expect(data[0]).toBe(data[1]);
    expect(data[1]).toBe(data[2]);
  });

  it.each([
    ["GIF", async () => bytes(flat(4, 4).gif())],
    ["TIFF", async () => bytes(flat(4, 4).tiff())],
    ["random bytes", async () => new Uint8Array(256).map((_, i) => (i * 73 + 11) % 256)],
    [
      "HEIC magic",
      async () => new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]),
    ],
    ["empty input", async () => new Uint8Array(0)],
  ])("rejects %s with ClassifyInputError", async (_name, make) => {
    await expect(decodeToRgb(await make())).rejects.toBeInstanceOf(ClassifyInputError);
  });

  it("rejects bytes whose decoder format disagrees with the magic bytes", async () => {
    // JPEG signature on a GIF body.
    const gif = await bytes(flat(4, 4).gif());
    const spoofed = new Uint8Array(gif.length + 3);
    spoofed.set([0xff, 0xd8, 0xff]);
    spoofed.set(gif, 3);
    await expect(decodeToRgb(spoofed)).rejects.toBeInstanceOf(ClassifyInputError);
  });

  it("rejects an animated WebP (only its first frame could be screened)", async () => {
    // Distinct frames: libwebp collapses identical ones into a still image.
    const frame = (r: number) =>
      sharp({ create: { width: 4, height: 4, channels: 3, background: { r, g: 0, b: 0 } } })
        .png()
        .toBuffer();
    const frames = [await frame(255), await frame(0)];
    const animated = await bytes(sharp(frames, { join: { animated: true } }).webp());
    expect((await sharp(animated).metadata()).pages).toBe(2);
    await expect(decodeToRgb(animated)).rejects.toBeInstanceOf(ClassifyInputError);
  });

  it("rejects an APNG (acTL chunk before IDAT) that sharp itself would decode", async () => {
    const png = await bytes(flat(4, 4).png());
    // Splice a valid acTL chunk (1 frame, infinite loop) right after IHDR
    // (8 signature bytes + 25 IHDR bytes).
    const body = new Uint8Array([0x61, 0x63, 0x54, 0x4c, 0, 0, 0, 1, 0, 0, 0, 0]);
    const chunk = Buffer.alloc(4 + body.length + 4);
    chunk.writeUInt32BE(8, 0);
    chunk.set(body, 4);
    chunk.writeUInt32BE(crc32(body), 4 + body.length);
    const apng = new Uint8Array(Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]));
    // The decoder accepts it, so the rejection below is the APNG check's.
    await expect(sharp(apng, { failOn: "error" }).raw().toBuffer()).resolves.toBeInstanceOf(Buffer);
    await expect(decodeToRgb(apng)).rejects.toThrow("Animated images are not supported");
  });

  it("rejects truncated JPEG and WebP with ClassifyInputError", async () => {
    // Noisy pixels so the entropy-coded data is long; cut inside the headers,
    // mid-stream, and near the end (a partially transferred thumbnail).
    const w = 64;
    const noisy = Buffer.alloc(w * w * 3);
    for (let i = 0; i < noisy.length; i++) noisy[i] = (i * 37) % 256;
    const raw = () => sharp(noisy, { raw: { width: w, height: w, channels: 3 } });
    for (const full of [await bytes(raw().jpeg()), await bytes(raw().webp())]) {
      for (const cut of [40, full.length >> 1, full.length - 2]) {
        await expect(decodeToRgb(full.subarray(0, cut))).rejects.toBeInstanceOf(ClassifyInputError);
      }
    }
  });

  it("rejects images over the 4-megapixel decode cap", async () => {
    // 2100×2000 = 4.2 MP, just over the cap.
    await expect(decodeToRgb(await bytes(flat(2100, 2000).jpeg()))).rejects.toBeInstanceOf(
      ClassifyInputError
    );
    await expect(decodeToRgb(await bytes(flat(2100, 2000).webp()))).rejects.toBeInstanceOf(
      ClassifyInputError
    );
  });

  it("never puts image bytes in the error message", async () => {
    const err = await decodeToRgb(new Uint8Array([0xff, 0xd8, 0xff, 0x41, 0x42, 0x43])).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(ClassifyInputError);
    expect((err as Error).message).toBe("Image could not be decoded");
  });
});
