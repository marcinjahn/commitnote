import { describe, expect, it } from "vitest";
import {
  floatingNewNoteState,
  isTextEntry,
  type FloatingNewNoteInputs,
} from "./floating-new-note";

const base: FloatingNewNoteInputs = {
  narrow: true,
  mobileView: "tree",
  treeLoaded: true,
  anyDialogOpen: false,
  searchOpen: false,
  textEntryFocused: false,
  keyboardOpen: false,
  treeDragActive: false,
  noteShownThisSession: false,
};

const hiddenCases: [string, Partial<FloatingNewNoteInputs>][] = [
  ["not narrow", { narrow: false }],
  ["note view", { mobileView: "note" }],
  ["tree not loaded", { treeLoaded: false }],
  ["dialog open", { anyDialogOpen: true }],
  ["search open", { searchOpen: true }],
  ["text entry focused", { textEntryFocused: true }],
  ["keyboard open", { keyboardOpen: true }],
  ["tree drag active", { treeDragActive: true }],
];

describe("floatingNewNoteState", () => {
  it.each(hiddenCases)("is hidden when %s", (_label, overrides) => {
    expect(floatingNewNoteState({ ...base, ...overrides })).toBe("hidden");
  });

  it.each(hiddenCases)("is hidden when %s even after a note was shown", (_label, overrides) => {
    expect(floatingNewNoteState({ ...base, noteShownThisSession: true, ...overrides })).toBe(
      "hidden",
    );
  });

  it("is extended before any note was shown", () => {
    expect(floatingNewNoteState(base)).toBe("extended");
  });

  it("is compact once a note was shown", () => {
    expect(floatingNewNoteState({ ...base, noteShownThisSession: true })).toBe("compact");
  });

  it.each([false, true])("stays hidden when not narrow (noteShownThisSession %s)", (shown) => {
    expect(floatingNewNoteState({ ...base, narrow: false, noteShownThisSession: shown })).toBe(
      "hidden",
    );
  });
});

describe("isTextEntry", () => {
  it.each([
    ["null", null, false],
    ["input without type", { tagName: "INPUT" }, true],
    ["lower-case input of type search", { tagName: "input", type: "search" }, true],
    ["email input", { tagName: "INPUT", type: "email" }, true],
    ["checkbox input", { tagName: "INPUT", type: "checkbox" }, false],
    ["radio input with mixed case type", { tagName: "INPUT", type: "Radio" }, false],
    ["button input", { tagName: "INPUT", type: "button" }, false],
    ["textarea", { tagName: "TEXTAREA" }, true],
    ["contenteditable div", { tagName: "DIV", isContentEditable: true }, true],
    ["plain div", { tagName: "DIV" }, false],
    ["button", { tagName: "BUTTON" }, false],
    ["select", { tagName: "SELECT" }, false],
  ] as const)("%s", (_label, element, expected) => {
    expect(isTextEntry(element)).toBe(expected);
  });
});
