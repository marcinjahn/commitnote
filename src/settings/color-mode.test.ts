import { describe, expect, it } from "vitest";
import {
  COLOR_MODE_OPTIONS,
  COLOR_SCHEME_BACKGROUNDS,
  colorScheme,
  parseColorMode,
} from "./color-mode";

describe("COLOR_MODE_OPTIONS", () => {
  it("has unique ids, exactly system, light and dark in order", () => {
    const ids = COLOR_MODE_OPTIONS.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["system", "light", "dark"]);
  });

  it("labels the options System, Light and Dark", () => {
    expect(COLOR_MODE_OPTIONS.map((option) => option.label)).toEqual([
      "System",
      "Light",
      "Dark",
    ]);
  });
});

describe("parseColorMode", () => {
  it.each(COLOR_MODE_OPTIONS.map((option) => option.id))("accepts %s", (id) => {
    expect(parseColorMode(id)).toBe(id);
  });

  it.each(["auto", "Dark", "", 1, null, undefined, {}])(
    "rejects %j",
    (value) => {
      expect(parseColorMode(value)).toBeUndefined();
    },
  );
});

describe("colorScheme", () => {
  it.each([
    ["system", true, "dark"],
    ["system", false, "light"],
    ["light", true, "light"],
    ["light", false, "light"],
    ["dark", true, "dark"],
    ["dark", false, "dark"],
  ] as const)("resolves %s with OS prefers dark %s to %s", (mode, os, scheme) => {
    expect(colorScheme(mode, os)).toBe(scheme);
  });
});

describe("COLOR_SCHEME_BACKGROUNDS", () => {
  it("holds the page background of each color scheme", () => {
    expect(COLOR_SCHEME_BACKGROUNDS).toEqual({
      light: "#fafafa",
      dark: "#0b0b0b",
    });
  });
});
