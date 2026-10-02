import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdownEditorExtensions } from "./create-markdown-editor";
import { buildLivePreviewDecorations } from "./live-preview";

function stateFor(doc: string, cursor: number): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: markdownEditorExtensions(),
  });
}

function hiddenRanges(state: EditorState): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  buildLivePreviewDecorations(state).between(
    0,
    state.doc.length,
    (from, to, deco) => {
      if (to > from && deco.spec.widget === undefined) {
        ranges.push([from, to]);
      }
    },
  );
  return ranges;
}

function widgetRanges(state: EditorState): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  buildLivePreviewDecorations(state).between(
    0,
    state.doc.length,
    (from, to, deco) => {
      if (deco.spec.widget !== undefined) {
        ranges.push([from, to]);
      }
    },
  );
  return ranges;
}

function isFullyHidden(
  hidden: readonly (readonly [number, number])[],
  from: number,
  to: number,
): boolean {
  for (let pos = from; pos < to; pos++) {
    if (!hidden.some(([f, t]) => f <= pos && pos < t)) return false;
  }
  return true;
}

describe("buildLivePreviewDecorations", () => {
  it("hides the header mark and its trailing space away from the cursor, but not on the heading line", () => {
    const doc = "# Title\nsecond line";

    const away = stateFor(doc, doc.length);
    expect(hiddenRanges(away)).toContainEqual([0, 2]);

    const onLine = stateFor(doc, 3);
    expect(hiddenRanges(onLine)).not.toContainEqual([0, 2]);
  });

  it("hides bold emphasis markers away from the cursor", () => {
    const doc = "**bold**\nsecond line";
    const state = stateFor(doc, doc.length);

    const hidden = hiddenRanges(state);
    expect(hidden).toContainEqual([0, 2]);
    expect(hidden).toContainEqual([6, 8]);
  });

  it("hides the link brackets and URL away from the cursor, keeping the link text visible", () => {
    const doc = "[text](https://x)\nsecond line";
    const state = stateFor(doc, doc.length);

    const hidden = hiddenRanges(state);
    const openBracket = doc.indexOf("[");
    const closingChunk = "](https://x)";
    const closingStart = doc.indexOf(closingChunk);
    const textStart = doc.indexOf("text");

    expect(isFullyHidden(hidden, openBracket, openBracket + 1)).toBe(true);
    expect(
      isFullyHidden(hidden, closingStart, closingStart + closingChunk.length),
    ).toBe(true);
    expect(isFullyHidden(hidden, textStart, textStart + "text".length)).toBe(
      false,
    );
  });

  it("keeps a URL used as the link text visible away from the cursor", () => {
    const doc = "[https://x.com/](https://x.com/)\nsecond line";
    const state = stateFor(doc, doc.length);

    const hidden = hiddenRanges(state);
    const label = "https://x.com/";
    const closingChunk = "](https://x.com/)";
    const closingStart = doc.indexOf(closingChunk);

    expect(isFullyHidden(hidden, 1, 1 + label.length)).toBe(false);
    expect(
      isFullyHidden(hidden, closingStart, closingStart + closingChunk.length),
    ).toBe(true);
  });

  it("shows a checkbox widget over the task marker even when the cursor is on that line", () => {
    const doc = "- [ ] task";
    const state = stateFor(doc, doc.indexOf("task"));

    const markerStart = doc.indexOf("[ ]");
    const widgets = widgetRanges(state);
    expect(widgets).toContainEqual([markerStart, markerStart + 3]);
  });

  it("replaces a horizontal rule with a widget when the cursor is elsewhere", () => {
    const doc = "---\nsecond line";
    const state = stateFor(doc, doc.length);

    expect(widgetRanges(state)).toContainEqual([0, 3]);
  });

  it("does not alter the document text while building decorations", () => {
    const doc =
      "# Title\n\n**bold** *em* ~~s~~ `code`\n\n- [ ] task\n\n---\n\n> quote\n\n[text](https://x)";
    const state = stateFor(doc, 0);

    buildLivePreviewDecorations(state);

    expect(state.doc.toString()).toBe(doc);
  });
});
