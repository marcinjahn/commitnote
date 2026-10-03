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

  it("gives every option a non-empty family", () => {
    for (const option of options) {
      expect(option.family.trim()).not.toBe("");
    }
  });

  it("ends the system and serif stacks in a generic family", () => {
    const family = (id: string) => options.find((o) => o.id === id)?.family;
    expect(family("system")).toMatch(/, sans-serif$/);
    expect(family("serif")).toMatch(/, serif$/);
  });
});

describe("parseNoteFont", () => {
  it.each(options.map((option) => option.id))("accepts %s", (id) => {
    expect(parseNoteFont(id)).toBe(id);
  });

  it.each(["nope", "Inter", 3, null, undefined])("rejects %j", (value) => {
    expect(parseNoteFont(value)).toBeUndefined();
  });
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
