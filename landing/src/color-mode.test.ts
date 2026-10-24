import { describe, expect, it } from "vitest";
import { applySavedColorMode } from "./color-mode";

const LIGHT = "#fafafa";
const DARK = "#0b0b0b";

function setup() {
  const colorScheme = { content: "light dark" };
  const themeColors = [
    { media: "(prefers-color-scheme: light)", content: LIGHT },
    { media: "(prefers-color-scheme: dark)", content: DARK },
  ];
  const root = { dataset: {} as Record<string, string> };
  const document = {
    documentElement: root,
    querySelector(selector: string) {
      if (selector === 'meta[name="color-scheme"]') return colorScheme;
      return themeColors.find((meta) => selector.includes(meta.media));
    },
    querySelectorAll() {
      return themeColors;
    },
  } as unknown as Document;
  return { document, colorScheme, themeColors, root };
}

const storageWith = (value: string | null) => ({ getItem: () => value });

describe("applySavedColorMode", () => {
  it.each([
    ["dark", DARK],
    ["light", LIGHT],
  ])("applies %s", (mode, color) => {
    const { document, colorScheme, themeColors, root } = setup();
    applySavedColorMode(storageWith(mode), document);
    expect(root.dataset.colorMode).toBe(mode);
    expect(colorScheme.content).toBe(mode);
    expect(themeColors.map((meta) => meta.content)).toEqual([color, color]);
  });

  it.each(["system", null, "sepia", ""])("ignores %j", (value) => {
    const { document, colorScheme, themeColors, root } = setup();
    applySavedColorMode(storageWith(value), document);
    expect(root.dataset.colorMode).toBeUndefined();
    expect(colorScheme.content).toBe("light dark");
    expect(themeColors.map((meta) => meta.content)).toEqual([LIGHT, DARK]);
  });

  it("swallows storage errors", () => {
    const { document, root } = setup();
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => applySavedColorMode(storage, document)).not.toThrow();
    expect(root.dataset.colorMode).toBeUndefined();
  });
});
