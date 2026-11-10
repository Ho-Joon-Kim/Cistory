import { describe, expect, it } from "vitest";
import {
  isBlocked,
  NSFW_BLOCK_PORN_PLUS_HENTAI,
  NSFW_BLOCK_SEXY,
  NSFW_MODEL_VERSION,
  type NsfwScores,
} from "./classifier";

function s(partial: Partial<NsfwScores>): NsfwScores {
  return { drawing: 0, hentai: 0, neutral: 0, porn: 0, sexy: 0, ...partial };
}

describe("isBlocked", () => {
  it("pins the thresholds and model version", () => {
    expect([NSFW_BLOCK_PORN_PLUS_HENTAI, NSFW_BLOCK_SEXY]).toEqual([0.5, 0.8]);
    expect(NSFW_MODEL_VERSION).toBe("nsfwjs@4.4.0/MobileNetV2");
  });

  it("blocks porn+hentai at exactly 0.5", () => {
    expect(isBlocked(s({ porn: 0.3, hentai: 0.2, neutral: 0.5 }))).toBe(true);
  });

  it("does not block porn+hentai just under 0.5", () => {
    expect(isBlocked(s({ porn: 0.3, hentai: 0.19, neutral: 0.51 }))).toBe(false);
  });

  it("blocks porn alone or hentai alone at the combined threshold", () => {
    expect(isBlocked(s({ porn: 0.5, neutral: 0.5 }))).toBe(true);
    expect(isBlocked(s({ hentai: 0.5, drawing: 0.5 }))).toBe(true);
  });

  it("blocks sexy at 0.8 but not 0.79", () => {
    expect(isBlocked(s({ sexy: 0.8, neutral: 0.2 }))).toBe(true);
    expect(isBlocked(s({ sexy: 0.79, neutral: 0.21 }))).toBe(false);
  });

  it.each([
    ["porn", Number.NaN],
    ["hentai", Number.NaN],
    ["sexy", Number.NaN],
    ["neutral", Number.NaN],
    ["drawing", Number.POSITIVE_INFINITY],
  ] as const)("fails closed when %s is %s", (key, value) => {
    expect(isBlocked(s({ neutral: 1, [key]: value }))).toBe(true);
  });

  it("passes neutral/drawing-dominant scores", () => {
    expect(isBlocked(s({ neutral: 0.9, sexy: 0.05, porn: 0.05 }))).toBe(false);
    expect(isBlocked(s({ drawing: 0.85, hentai: 0.1, neutral: 0.05 }))).toBe(false);
  });
});
