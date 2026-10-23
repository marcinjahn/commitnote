import { keyboardInset } from "../dialogs/keyboard-inset";

export type FloatingNewNoteState = "hidden" | "extended" | "compact";

export interface FloatingNewNoteInputs {
  narrow: boolean;
  mobileView: "tree" | "note";
  treeLoaded: boolean;
  anyDialogOpen: boolean;
  searchOpen: boolean;
  textEntryFocused: boolean;
  keyboardOpen: boolean;
  treeDragActive: boolean;
  noteShownThisSession: boolean;
}

export function floatingNewNoteState(inputs: FloatingNewNoteInputs): FloatingNewNoteState {
  if (
    !inputs.narrow ||
    inputs.mobileView !== "tree" ||
    !inputs.treeLoaded ||
    inputs.anyDialogOpen ||
    inputs.searchOpen ||
    inputs.textEntryFocused ||
    inputs.keyboardOpen ||
    inputs.treeDragActive
  ) {
    return "hidden";
  }
  return inputs.noteShownThisSession ? "compact" : "extended";
}

export const KEYBOARD_OPEN_MIN_INSET = 150;

export function isKeyboardOpen(
  layoutHeight: number,
  viewport: { height: number; offsetTop: number; scale: number },
): boolean {
  if (viewport.scale > 1) return false;
  return keyboardInset(layoutHeight, viewport) >= KEYBOARD_OPEN_MIN_INSET;
}

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "radio",
  "submit",
  "reset",
  "range",
  "color",
  "file",
  "image",
  "hidden",
]);

export function isTextEntry(
  element: { tagName: string; type?: string; isContentEditable?: boolean } | null,
): boolean {
  if (!element) return false;
  if (element.isContentEditable === true) return true;
  const tag = element.tagName.toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = (element.type || "text").toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type);
  }
  return false;
}
