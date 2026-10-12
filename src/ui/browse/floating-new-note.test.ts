import { describe, expect, it } from "vitest";
import {
  KEYBOARD_OPEN_MIN_INSET,
  floatingNewNoteState,
  isKeyboardOpen,
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

describe("isKeyboardOpen", () => {
  const viewport = (height: number, offsetTop = 0, scale = 1) => ({ height, offsetTop, scale });

  it.each([
    ["the visual viewport fills the layout", viewport(800)],
    ["a sub-pixel gap from fractional scaling", viewport(799.5)],
    ["a few pixels short", viewport(797)],
    ["just under the threshold", viewport(800 - KEYBOARD_OPEN_MIN_INSET + 1)],
    ["pinch-zoomed in", viewport(400, 100, 2)],
  ])("is closed when %s", (_label, visual) => {
    expect(isKeyboardOpen(800, visual)).toBe(false);
  });

  it.each([
    ["at the threshold", viewport(800 - KEYBOARD_OPEN_MIN_INSET)],
    ["a phone keyboard covers the bottom", viewport(480)],
    ["the visual viewport is scrolled while the keyboard is up", viewport(400, 50)],
  ])("is open %s", (_label, visual) => {
    expect(isKeyboardOpen(800, visual)).toBe(true);
  });
});
