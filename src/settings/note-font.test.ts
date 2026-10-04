import { describe, expect, it } from "vitest";
import {
  NOTE_FONT_OPTIONS,
  noteFontFamily,
  parseNoteFont,
  type NoteFontOption,
} from "./note-font";

const options: readonly NoteFontOption[] = NOTE_FONT_OPTIONS;

describe("NOTE_FONT_OPTIONS", () => {
  it("has unique ids", () => {
    expect(new Set(options.map((option) => option.id)).size).toBe(
      options.length,
    );
  });

  it("starts with inter", () => {
    expect(options[0].id).toBe("inter");
  });

  it("has exactly the expected ids in order", () => {
    expect(options.map((option) => option.id)).toEqual([
      "inter",
      "system",
      "ibm-plex-sans",
      "atkinson-hyperlegible",
      "nunito",
      "ia-writer-quattro",
      "literata",
      "source-serif",
      "lora",
      "jetbrains-mono",
      "ibm-plex-mono",
    ]);
  });

  it("gives every option a non-empty label, description and family", () => {
    for (const option of options) {
      expect(option.label.trim()).not.toBe("");
      expect(option.description.trim()).not.toBe("");
      expect(option.family.trim()).not.toBe("");
    }
  });

  it.each([
    ["ibm-plex-sans", "sans-serif"],
    ["atkinson-hyperlegible", "sans-serif"],
    ["nunito", "sans-serif"],
    ["ia-writer-quattro", "sans-serif"],
    ["literata", "serif"],
    ["source-serif", "serif"],
    ["lora", "serif"],
    ["jetbrains-mono", "var(--font-mono)"],
    ["ibm-plex-mono", "var(--font-mono)"],
  ])("gives bundled option %s a quoted family and a %s fallback", (id, ending) => {
    const option = options.find((o) => o.id === id);
    expect(option?.family).toMatch(/^"[^"]+"/);
    expect(option?.family.endsWith(ending)).toBe(true);
  });
});

describe("parseNoteFont", () => {
  it.each(options.map((option) => option.id))("accepts %s", (id) => {
    expect(parseNoteFont(id)).toBe(id);
  });

  it.each(["serif", "mono", "System", "", 42, undefined])(
    "rejects %j",
    (value) => {
      expect(parseNoteFont(value)).toBeUndefined();
    },
  );
});

describe("noteFontFamily", () => {
  it.each(
    NOTE_FONT_OPTIONS.map((option) => [option.id, option.family] as const),
  )(
    "returns the family of %s",
    (id, family) => {
      expect(noteFontFamily(id)).toBe(family);
    },
  );
});
