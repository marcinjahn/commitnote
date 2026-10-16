import { describe, expect, it } from "vitest";
import { ancestorFolders, shouldFollowFocus } from "./relocation-follow";

describe("ancestorFolders", () => {
  it("lists every folder above the note, outermost first", () => {
    expect(ancestorFolders(["A", "B", "note"])).toEqual([["A"], ["A", "B"]]);
  });

  it("is empty for a root note", () => {
    expect(ancestorFolders(["note"])).toEqual([]);
  });
});

describe("shouldFollowFocus", () => {
  const from = ["A", "note"];

  it("follows when the old row had focus and focus was lost", () => {
    expect(shouldFollowFocus({ recordedFocus: ["A", "note"], from, focusLost: true })).toBe(true);
  });

  it("does not follow when focus is still somewhere", () => {
    expect(shouldFollowFocus({ recordedFocus: from, from, focusLost: false })).toBe(false);
  });

  it("does not follow when another row had focus", () => {
    expect(shouldFollowFocus({ recordedFocus: ["B"], from, focusLost: true })).toBe(false);
  });

  it("does not follow without recorded focus", () => {
    expect(shouldFollowFocus({ recordedFocus: null, from, focusLost: true })).toBe(false);
  });
});
