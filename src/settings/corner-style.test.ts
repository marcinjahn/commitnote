import { describe, expect, it } from "vitest";
import { CORNER_STYLE_OPTIONS, parseCornerStyle } from "./corner-style";

describe("CORNER_STYLE_OPTIONS", () => {
  it("has unique ids, exactly rounded and square in order", () => {
    const ids = CORNER_STYLE_OPTIONS.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["rounded", "square"]);
  });

  it("labels the options Rounded and Square", () => {
    expect(CORNER_STYLE_OPTIONS.map((option) => option.label)).toEqual([
      "Rounded",
      "Square",
    ]);
  });
});

describe("parseCornerStyle", () => {
  it.each(CORNER_STYLE_OPTIONS.map((option) => option.id))(
    "accepts %s",
    (id) => {
      expect(parseCornerStyle(id)).toBe(id);
    },
  );

  it.each(["round", "Square", "", 1, null, undefined, {}])(
    "rejects %j",
    (value) => {
      expect(parseCornerStyle(value)).toBeUndefined();
    },
  );
});
