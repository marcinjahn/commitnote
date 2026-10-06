import { describe, expect, it } from "vitest";
import { accentOption } from "../settings/accent-palette";
import {
  COLOR_TAG_PALETTE,
  colorTagOption,
  colorTagStyle,
  parseColorTag,
} from "./color-tag";

const ACCENT_BY_TAG = {
  red: "red",
  orange: "orange",
  yellow: "amber",
  green: "green",
  blue: "blue",
  purple: "violet",
} as const;

describe("COLOR_TAG_PALETTE", () => {
  it("lists the six color tags in order with labels", () => {
    expect(COLOR_TAG_PALETTE.map((o) => [o.id, o.label])).toEqual([
      ["red", "Red"],
      ["orange", "Orange"],
      ["yellow", "Yellow"],
      ["green", "Green"],
      ["blue", "Blue"],
      ["purple", "Purple"],
    ]);
  });

  it("has unique ids", () => {
    const ids = COLOR_TAG_PALETTE.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(COLOR_TAG_PALETTE.map((o) => o.id))(
    "takes %s values from the mapped accent option",
    (id) => {
      const accent = accentOption(ACCENT_BY_TAG[id]);
      const option = colorTagOption(id);
      expect(option.light).toBe(accent.light);
      expect(option.dark).toBe(accent.dark);
    },
  );
});

describe("parseColorTag", () => {
  it("accepts the six ids", () => {
    for (const option of COLOR_TAG_PALETTE) {
      expect(parseColorTag(option.id)).toBe(option.id);
    }
  });

  it.each(["amber", "violet", "", null, 42])("rejects %j", (raw) => {
    expect(parseColorTag(raw)).toBeNull();
  });
});

describe("colorTagStyle", () => {
  it("exposes both custom properties", () => {
    const red = accentOption("red");
    const style = colorTagStyle("red");
    expect(style).toContain(`--tag-light: ${red.light}`);
    expect(style).toContain(`--tag-dark: ${red.dark}`);
  });
});
