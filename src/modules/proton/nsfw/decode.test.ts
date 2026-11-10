import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { ClassifyInputError } from "./classifier";
import { decodeJpegToRgb } from "./decode";

function encodeJpeg(width: number, height: number, rgba = [128, 64, 32, 255]): Uint8Array {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return new Uint8Array(jpeg.encode({ width, height, data }, 90).data);
}

describe("decodeJpegToRgb", () => {
  it("decodes a JPEG to RGB without alpha", () => {
    const { width, height, data } = decodeJpegToRgb(encodeJpeg(8, 6));
    expect([width, height, data.length]).toEqual([8, 6, 8 * 6 * 3]);
    expect(data).toBeInstanceOf(Uint8Array);
    // Lossy, but a flat colour survives within a few levels.
    expect(Math.abs(data[0] - 128)).toBeLessThan(6);
    expect(Math.abs(data[1] - 64)).toBeLessThan(6);
    expect(Math.abs(data[2] - 32)).toBeLessThan(6);
  });

  it.each([
    ["PNG", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]],
    ["WebP", [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]],
    ["HEIC", [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]],
  ])("rejects %s magic bytes with ClassifyInputError", (_name, bytes) => {
    expect(() => decodeJpegToRgb(new Uint8Array(bytes))).toThrow(ClassifyInputError);
  });

  it("rejects empty input with ClassifyInputError", () => {
    expect(() => decodeJpegToRgb(new Uint8Array(0))).toThrow(ClassifyInputError);
  });

  it("rejects truncated JPEG with ClassifyInputError", () => {
    // Noisy pixels so the entropy-coded scan is long; cut inside the headers,
    // mid-scan, and just before EOI (a partially transferred thumbnail).
    const w = 64;
    const noisy = Buffer.alloc(w * w * 4);
    for (let i = 0; i < noisy.length; i++) noisy[i] = (i * 37) % 256;
    const full = new Uint8Array(jpeg.encode({ width: w, height: w, data: noisy }, 90).data);
    expect(() => decodeJpegToRgb(full.subarray(0, 40))).toThrow(ClassifyInputError);
    expect(() => decodeJpegToRgb(full.subarray(0, full.length >> 1))).toThrow(ClassifyInputError);
    expect(() => decodeJpegToRgb(full.subarray(0, full.length - 2))).toThrow(ClassifyInputError);
  });

  it("rejects images over the 4-megapixel decode cap", () => {
    // 2100×2000 = 4.2 MP, just over the cap.
    expect(() => decodeJpegToRgb(encodeJpeg(2100, 2000))).toThrow(ClassifyInputError);
  });
});
