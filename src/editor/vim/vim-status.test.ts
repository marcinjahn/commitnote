import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  editingModeOf,
  setVimStatus,
  vimStatusField,
  vimStatusOf,
} from "./vim-status";

const DOC = "first\nsecond\nthe **bold** word\nlast";

function stateAt(head: number): EditorState {
  return EditorState.create({
    doc: DOC,
    selection: { anchor: head },
    extensions: [vimStatusField],
  });
}

describe("vimStatusField", () => {
  it("starts in normal mode with no transient state", () => {
    expect(vimStatusOf(stateAt(0))).toEqual({
      mode: "normal",
      line: 1,
      column: 1,
      pendingKeys: "",
      recording: null,
      message: null,
      commandLine: null,
    });
  });

  it("reports the head as a 1-based line and column", () => {
    const lineStart = DOC.indexOf("the **bold**");
    const status = vimStatusOf(stateAt(lineStart + 4));

    expect(status).toMatchObject({ line: 3, column: 5 });
  });

  it("counts hidden markup as stored characters", () => {
    const lineStart = DOC.indexOf("the **bold**");
    const status = vimStatusOf(stateAt(lineStart + "the **bold**".length));

    expect(status).toMatchObject({ line: 3, column: 13 });
  });

  it("recomputes the position when the selection moves", () => {
    const state = stateAt(0).update({
      selection: { anchor: DOC.indexOf("last") + 2 },
    }).state;

    expect(vimStatusOf(state)).toMatchObject({ line: 4, column: 3 });
  });

  it("recomputes the position when the document changes", () => {
    const state = stateAt(2).update({
      changes: { from: 0, insert: "a\nb\n" },
      selection: { anchor: 6 },
    }).state;

    expect(vimStatusOf(state)).toMatchObject({ line: 3, column: 3 });
  });

  it("merges every status effect in order", () => {
    const state = stateAt(0).update({
      effects: [
        setVimStatus.of({ mode: "insert", pendingKeys: "d" }),
        setVimStatus.of({ pendingKeys: "", recording: "q" }),
      ],
    }).state;

    expect(vimStatusOf(state)).toMatchObject({
      mode: "insert",
      pendingKeys: "",
      recording: "q",
    });
  });

  it("keeps the same object when nothing changed", () => {
    const state = stateAt(3);
    const next = state.update({ changes: [] }).state;

    expect(vimStatusOf(next)).toBe(vimStatusOf(state));
  });
});

describe("without the field", () => {
  const state = EditorState.create({ doc: "text" });

  it("has no status", () => {
    expect(vimStatusOf(state)).toBeNull();
    expect(editingModeOf(state)).toBeNull();
  });
});

describe("editingModeOf", () => {
  it("returns the current mode", () => {
    const state = stateAt(0).update({
      effects: setVimStatus.of({ mode: "visual-line" }),
    }).state;

    expect(editingModeOf(state)).toBe("visual-line");
  });
});
