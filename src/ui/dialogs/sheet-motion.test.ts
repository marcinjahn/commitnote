import { describe, expect, it } from "vitest";
import {
  FALLBACK_SHEET_EXIT_MS,
  parseCssDuration,
  sheetExitDuration,
  sheetExitTokenMs,
  type SheetExitInputs,
} from "./sheet-motion";

const favourable: SheetExitInputs = {
  narrowLayout: true,
  reducedMotion: false,
  swiped: false,
  tokenDurationMs: 200,
};

describe("sheetExitDuration", () => {
  it("equals the token duration on the narrow layout", () => {
    expect(sheetExitDuration(favourable)).toBe(200);
  });

  it("follows a different token duration", () => {
    expect(sheetExitDuration({ ...favourable, tokenDurationMs: 350 })).toBe(350);
  });

  it("is 0 on the desktop layout", () => {
    expect(sheetExitDuration({ ...favourable, narrowLayout: false })).toBe(0);
  });

  it("is 0 under reduced motion", () => {
    expect(sheetExitDuration({ ...favourable, reducedMotion: true })).toBe(0);
  });

  it("is 0 after a swipe", () => {
    expect(sheetExitDuration({ ...favourable, swiped: true })).toBe(0);
  });

  it("is 0 when the token duration is 0", () => {
    expect(sheetExitDuration({ ...favourable, tokenDurationMs: 0 })).toBe(0);
  });

  it("is 0 for a negative token duration", () => {
    expect(sheetExitDuration({ ...favourable, tokenDurationMs: -1 })).toBe(0);
  });

  it("is 0 for NaN", () => {
    expect(sheetExitDuration({ ...favourable, tokenDurationMs: Number.NaN })).toBe(0);
  });

  it("is 0 for Infinity", () => {
    expect(sheetExitDuration({ ...favourable, tokenDurationMs: Infinity })).toBe(0);
  });
});

describe("parseCssDuration", () => {
  it("parses milliseconds", () => {
    expect(parseCssDuration("200ms")).toBe(200);
  });

  it("parses zero", () => {
    expect(parseCssDuration("0ms")).toBe(0);
    expect(parseCssDuration("0s")).toBe(0);
  });

  it("parses seconds", () => {
    expect(parseCssDuration("1s")).toBe(1000);
    expect(parseCssDuration("0.2s")).toBe(200);
  });

  it("parses decimals without a leading zero", () => {
    expect(parseCssDuration(".25s")).toBe(250);
    expect(parseCssDuration(".5ms")).toBe(0.5);
  });

  it("parses decimal milliseconds", () => {
    expect(parseCssDuration("12.5ms")).toBe(12.5);
  });

  it("avoids floating point noise", () => {
    expect(parseCssDuration("0.3s")).toBe(300);
    expect(parseCssDuration("0.35s")).toBe(350);
  });

  it("trims surrounding whitespace", () => {
    expect(parseCssDuration(" 300ms ")).toBe(300);
    expect(parseCssDuration("\n0.2s\t")).toBe(200);
  });

  it("returns null for an empty string", () => {
    expect(parseCssDuration("")).toBeNull();
    expect(parseCssDuration("   ")).toBeNull();
  });

  it("returns null for a unitless number", () => {
    expect(parseCssDuration("200")).toBeNull();
  });

  it("returns null for text", () => {
    expect(parseCssDuration("abc")).toBeNull();
  });

  it("returns null for negative values", () => {
    expect(parseCssDuration("-5ms")).toBeNull();
    expect(parseCssDuration("-0.1s")).toBeNull();
  });

  it("returns null for functions and variables", () => {
    expect(parseCssDuration("calc(1s)")).toBeNull();
    expect(parseCssDuration("var(--x)")).toBeNull();
  });

  it("returns null for other units and inner whitespace", () => {
    expect(parseCssDuration("200px")).toBeNull();
    expect(parseCssDuration("200 ms")).toBeNull();
  });
});

describe("sheetExitTokenMs", () => {
  it("returns the parsed value", () => {
    expect(sheetExitTokenMs("0.3s")).toBe(300);
    expect(sheetExitTokenMs("150ms")).toBe(150);
  });

  it("keeps a parsed zero", () => {
    expect(sheetExitTokenMs("0ms")).toBe(0);
  });

  it("falls back to 200 for unparsable values", () => {
    expect(FALLBACK_SHEET_EXIT_MS).toBe(200);
    expect(sheetExitTokenMs("")).toBe(200);
    expect(sheetExitTokenMs("var(--x)")).toBe(200);
  });
});
