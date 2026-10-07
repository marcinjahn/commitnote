import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdownEditorExtensions } from "./create-markdown-editor";
import { buildLivePreviewDecorations } from "./live-preview";

function stateFor(doc: string): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(doc.length),
    extensions: markdownEditorExtensions(),
  });
}

function listMarkRanges(state: EditorState): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  buildLivePreviewDecorations(state).between(
    0,
    state.doc.length,
    (from, to, deco) => {
      if (deco.spec.class === "cm-list-mark") ranges.push([from, to]);
    },
  );
  return ranges;
}

describe("list marker decoration", () => {
  it.each(["-", "*", "+"])("marks a %s bullet", (bullet) => {
    const state = stateFor(`${bullet} item`);
    expect(listMarkRanges(state)).toEqual([[0, 1]]);
  });

  it("marks an ordered number with its dot", () => {
    expect(listMarkRanges(stateFor("1. item"))).toEqual([[0, 2]]);
  });

  it("marks the bullet before a task checkbox but not the checkbox", () => {
    expect(listMarkRanges(stateFor("- [ ] todo"))).toEqual([[0, 1]]);
  });

  it("does not mark headings, blockquotes or emphasis", () => {
    expect(listMarkRanges(stateFor("# Title\n\n> quote\n\n*text*"))).toEqual(
      [],
    );
  });

  it("leaves the document text unchanged", () => {
    const doc = "- a\n1. b\n- [ ] c";
    const state = stateFor(doc);
    buildLivePreviewDecorations(state);
    expect(state.doc.toString()).toBe(doc);
  });
});
