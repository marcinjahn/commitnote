import { describe, expect, it } from "vitest";
import {
  isAtOrWithin,
  isWithinFolder,
  notePathEquals,
  parentPath,
} from "./change";

describe("notePathEquals", () => {
  it("is true for two empty paths", () => {
    expect(notePathEquals([], [])).toBe(true);
  });

  it("is true for equal paths", () => {
    expect(notePathEquals(["Projects", "Ideas"], ["Projects", "Ideas"])).toBe(
      true,
    );
  });

  it("is false for paths of different length", () => {
    expect(notePathEquals(["Projects"], ["Projects", "Ideas"])).toBe(false);
  });

  it("is false for paths differing at some segment", () => {
    expect(notePathEquals(["Projects", "Ideas"], ["Projects", "Notes"])).toBe(
      false,
    );
  });
});

describe("isWithinFolder", () => {
  it("is true for a direct child", () => {
    expect(isWithinFolder(["Projects", "Ideas"], ["Projects"])).toBe(true);
  });

  it("is true for a deep descendant", () => {
    expect(
      isWithinFolder(["Projects", "commitnote", "Ideas"], ["Projects"]),
    ).toBe(true);
  });

  it("is true for any path relative to the root folder", () => {
    expect(isWithinFolder(["Projects"], [])).toBe(true);
  });

  it("is false for the folder itself", () => {
    expect(isWithinFolder(["Projects"], ["Projects"])).toBe(false);
  });

  it("is false for a sibling", () => {
    expect(isWithinFolder(["Notes"], ["Projects"])).toBe(false);
  });

  it("is false for an ancestor", () => {
    expect(isWithinFolder(["Projects"], ["Projects", "Ideas"])).toBe(false);
  });

  it("is false for the root path relative to itself", () => {
    expect(isWithinFolder([], [])).toBe(false);
  });
});

describe("isAtOrWithin", () => {
  it("is true for the folder itself", () => {
    expect(isAtOrWithin(["Projects"], ["Projects"])).toBe(true);
  });

  it("is true for a descendant", () => {
    expect(isAtOrWithin(["Projects", "Ideas"], ["Projects"])).toBe(true);
  });

  it("is false for a sibling or an ancestor", () => {
    expect(isAtOrWithin(["Notes"], ["Projects"])).toBe(false);
    expect(isAtOrWithin(["Projects"], ["Projects", "Ideas"])).toBe(false);
  });
});

describe("parentPath", () => {
  it("returns the empty path for a top-level item", () => {
    expect(parentPath(["Projects"])).toEqual([]);
  });

  it("drops the last segment", () => {
    expect(parentPath(["Projects", "commitnote", "Ideas"])).toEqual([
      "Projects",
      "commitnote",
    ]);
  });

  it("throws for the root path", () => {
    expect(() => parentPath([])).toThrow(RangeError);
  });
});
