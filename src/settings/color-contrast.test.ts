import { describe, expect, it } from "vitest";
import {
  compositeOver,
  contrastRatio,
  mixSrgb,
  parseHex,
  relativeLuminance,
} from "./color-contrast";

const black = parseHex("#000000");
const white = parseHex("#ffffff");

describe("parseHex", () => {
  it("parses long and short forms", () => {
    expect(parseHex("#3358d4")).toEqual({ r: 51, g: 88, b: 212, a: 1 });
    expect(parseHex("#fa0")).toEqual({ r: 255, g: 170, b: 0, a: 1 });
  });

  it("rejects anything else", () => {
    expect(() => parseHex("red")).toThrow();
    expect(() => parseHex("#12345")).toThrow();
  });
});

describe("relativeLuminance", () => {
  it("is 0 for black and 1 for white", () => {
    expect(relativeLuminance(black)).toBe(0);
    expect(relativeLuminance(white)).toBeCloseTo(1, 10);
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white in either order", () => {
    expect(contrastRatio(black, white)).toBeCloseTo(21, 10);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 10);
  });

  it("is about 4.48 for #777777 on white", () => {
    expect(contrastRatio(parseHex("#777777"), white)).toBeCloseTo(4.48, 2);
  });
});

describe("mixSrgb", () => {
  it("mixes two colours by percentage", () => {
    expect(mixSrgb(black, 50, white)).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
  });

  it("turns the percentage into alpha when mixing with transparent", () => {
    const transparent = { r: 0, g: 0, b: 0, a: 0 };
    expect(mixSrgb(parseHex("#336699"), 40, transparent)).toEqual({
      r: 51,
      g: 102,
      b: 153,
      a: 0.4,
    });
  });
});

describe("compositeOver", () => {
  it("blends by alpha and returns an opaque colour", () => {
    expect(compositeOver({ ...white, a: 0.25 }, black)).toEqual({
      r: 63.75,
      g: 63.75,
      b: 63.75,
      a: 1,
    });
  });
});
