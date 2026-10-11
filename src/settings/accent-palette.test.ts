import { describe, expect, it } from "vitest";
import {
  ACCENT_PALETTE,
  accentCustomProperties,
  parseAccentColor,
  type AccentOption,
} from "./accent-palette";
import { contrastRatio, parseHex } from "./color-contrast";

function contrast(a: string, b: string): number {
  return contrastRatio(parseHex(a), parseHex(b));
}

const options: readonly AccentOption[] = ACCENT_PALETTE;
const colorOptions = options.filter((option) => option.id !== "system");

describe("ACCENT_PALETTE", () => {
  it("starts with the system option", () => {
    expect(options[0].id).toBe("system");
  });

  it("has unique ids", () => {
    const ids = options.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has exactly one neutral color option", () => {
    expect(colorOptions.filter((option) => option.neutral)).toHaveLength(1);
  });

  it("gives every color option both colors and the system option none", () => {
    for (const option of colorOptions) {
      expect(option.light).toBeDefined();
      expect(option.dark).toBeDefined();
    }
    expect(options[0].light).toBeUndefined();
    expect(options[0].dark).toBeUndefined();
  });

  it("keeps light colors at 3:1 contrast or more on a light surface", () => {
    for (const option of colorOptions) {
      expect(contrast(option.light!, "#fafafa")).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps dark colors at 3:1 contrast or more on a dark surface", () => {
    for (const option of colorOptions) {
      expect(contrast(option.dark!, "#0b0b0b")).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("parseAccentColor", () => {
  it("accepts every palette id", () => {
    for (const option of options) {
      expect(parseAccentColor(option.id)).toBe(option.id);
    }
  });

  it("rejects values that are not a palette id", () => {
    expect(parseAccentColor("nope")).toBeUndefined();
    expect(parseAccentColor(3)).toBeUndefined();
    expect(parseAccentColor(null)).toBeUndefined();
    expect(parseAccentColor(undefined)).toBeUndefined();
  });
});

describe("accentCustomProperties", () => {
  it("returns both colors for a color option", () => {
    expect(accentCustomProperties("teal")).toEqual({
      "--accent-light": "#008573",
      "--accent-dark": "#0bd8b6",
    });
  });

  it("returns null for both properties for the system option", () => {
    expect(accentCustomProperties("system")).toEqual({
      "--accent-light": null,
      "--accent-dark": null,
    });
  });
});
